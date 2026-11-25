import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '../src/storage.js';
import { createApp } from '../src/app.js';
import { citationQuery, extractDoi, searchCitation, getCandidate } from '../src/citations.js';
import { downloadPdf, isPublicAddress } from '../src/download.js';

const pdf = Buffer.from('%PDF-1.4\nsample content\n%%EOF');
const item = {
  id: 'https://openalex.org/W123', title: 'A paper', doi: 'https://doi.org/10.1234/example',
  authorships: [{ author: { display_name: 'A Author' } }], publication_year: 2024,
  locations: [{ is_oa: true, pdf_url: 'https://example.org/a.pdf' }]
};

test('citation matching distinguishes exact DOI, uncertain titles and bare references', async () => {
  assert.equal(extractDoi('See https://doi.org/10.1234/Example.'), '10.1234/example');
  assert.throws(() => citationQuery('[12]'), /bibliography entry/);
  const fakeFetch = async url => ({ ok: true, json: async () => url.includes('?') ? { results: [item] } : item });
  assert.equal((await searchCitation('10.1234/example', fakeFetch)).confident.id, 'W123');
  assert.equal((await searchCitation('A paper on research', fakeFetch)).confident, null);
  assert.deepEqual((await getCandidate('OPENALEX', 'W123', fakeFetch)).pdfUrls, ['https://example.org/a.pdf']);
  assert.deepEqual((await getCandidate('OPENALEX', 'W123', async () => ({
    ok: true, json: async () => ({ ...item, locations: [{ is_oa: false, pdf_url: 'https://example.org/a.pdf' }] })
  }))).pdfUrls, []);
  await assert.rejects(() => getCandidate('OPENALEX', 'W123 OR *', fakeFetch), /Invalid paper identifier/);
});

test('download addresses reject private, local, mapped and tunnel addresses', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '::1', '::ffff:127.0.0.1', '2002:7f00:1::', '2001::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('download rejects non-HTTPS and loopback destinations before connecting', async () => {
  await assert.rejects(() => downloadPdf('http://example.org/a.pdf', 'unused', 1024), /public HTTPS/);
  await assert.rejects(() => downloadPdf('https://127.0.0.1/a.pdf', 'unused', 1024), /not public/);
});

test('upload, limits, citation download, open and persistent library', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paper-reader-test-'));
  const storage = new Storage({ dataDir: dir, maxPdfBytes: 60, maxStorageBytes: 70 });
  await storage.init();
  const services = {
    searchCitation: async () => ({
      candidates: [{ id: 'W123', source: 'OPENALEX', title: 'A paper', doi: '10.1234/example', pdfUrls: ['https://example.org/a.pdf'] }],
      confident: { id: 'W123', source: 'OPENALEX', title: 'A paper', doi: '10.1234/example', pdfUrls: ['https://example.org/a.pdf'] }
    }),
    getCandidate: async () => ({ title: item.title, doi: '10.1234/example', pdfUrls: ['https://blocked.example/a.pdf', 'https://example.org/a.pdf'] }),
    downloadPdf: async (url, destination) => {
      if (url.includes('blocked')) throw new Error('HTTP 403');
      return writeFile(destination, pdf);
    }
  };
  const server = createApp(storage, services).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    storage.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const upload = async (content, filename = 'my-paper.pdf') => {
    const body = new FormData();
    body.append('file', new Blob([content], { type: 'application/pdf' }), filename);
    return fetch(`${base}/api/papers`, { method: 'POST', body });
  };
  const bad = await upload('not a PDF');
  assert.match((await bad.json()).error, /not a valid PDF/);
  const oversized = await upload('x'.repeat(61));
  assert.match((await oversized.json()).error, /size limit/);
  const uploaded = await upload(pdf);
  assert.equal(uploaded.status, 201);
  const first = (await uploaded.json()).paper;
  assert.equal(first.title, 'my-paper');
  assert.deepEqual(Buffer.from(await (await fetch(`${base}/api/papers/${first.id}/file`)).arrayBuffer()), pdf);
  const search = await fetch(`${base}/api/citations/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '10.1234/example' })
  });
  const matches = await search.json();
  assert.equal(matches.confident.hasPdf, true);
  assert.equal('pdfUrls' in matches.confident, false);
  const download = () => fetch(`${base}/api/citations/download`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'OPENALEX', id: 'W123', url: 'https://evil.invalid' })
  });
  const downloaded = await download();
  assert.equal(downloaded.status, 201);
  assert.equal((await downloaded.json()).paper.doi, '10.1234/example');
  assert.equal((await (await download()).json()).existing, true);
  const full = await upload(pdf);
  assert.match((await full.json()).error, /storage limit/);
  const crossOrigin = await fetch(`${base}/api/citations/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: '{}'
  });
  assert.equal(crossOrigin.status, 403);
  storage.db.close();
  await storage.init();
  assert.equal(storage.list().length, 2);
});

test('reading progress API, SQLite persistence, cleanup and SPA fallback routes', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paper-reader-spa-'));
  const storage = new Storage({ dataDir: dir, maxPdfBytes: 1024, maxStorageBytes: 4096 });
  await storage.init();
  const server = createApp(storage).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    storage.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const upload = async filename => {
    const body = new FormData();
    body.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);
    const res = await fetch(`${base}/api/papers`, { method: 'POST', body });
    assert.equal(res.status, 201);
    return (await res.json()).paper;
  };

  const paperA = await upload('paper-a.pdf');
  const paperB = await upload('paper-b.pdf');

  // Initial reading state is empty
  const emptyState = await (await fetch(`${base}/api/reading-state`)).json();
  assert.deepEqual(emptyState, { lastPaperId: null, positions: {} });

  // Save progress via PUT
  const putRes = await fetch(`${base}/api/papers/${paperA.id}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 3, offset: 0.45, zoom: 1.25 })
  });
  assert.equal(putRes.status, 200);
  const putData = await putRes.json();
  assert.equal(putData.progress.page, 3);
  assert.equal(putData.progress.offset, 0.45);
  assert.equal(putData.progress.zoom, 1.25);

  // Save progress for paper B via POST text/plain (sendBeacon compatibility)
  await new Promise(r => setTimeout(r, 10));
  const beaconRes = await fetch(`${base}/api/papers/${paperB.id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ page: 2, offset: 0.1, zoom: 1 })
  });
  assert.equal(beaconRes.status, 200);

  // Updating paper A with opened: false preserves paper B as lastPaperId
  const silentRes = await fetch(`${base}/api/papers/${paperA.id}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 4, offset: 0.2, opened: false })
  });
  assert.equal(silentRes.status, 200);

  const listPayload = await (await fetch(`${base}/api/papers`)).json();
  assert.equal(listPayload.readingState.lastPaperId, paperB.id);
  assert.equal(listPayload.readingState.positions[paperA.id].page, 4);
  assert.equal(listPayload.readingState.positions[paperB.id].page, 2);

  // Validation and missing paper checks
  const badPage = await fetch(`${base}/api/papers/${paperA.id}/progress`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 0 })
  });
  assert.equal(badPage.status, 400);
  const badOffset = await fetch(`${base}/api/papers/${paperA.id}/progress`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset: 1.5 })
  });
  assert.equal(badOffset.status, 400);
  const missingPaper = await fetch(`${base}/api/papers/nonexistent/progress`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 1, offset: 0 })
  });
  assert.equal(missingPaper.status, 404);
  const crossOrigin = await fetch(`${base}/api/papers/${paperA.id}/progress`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: '{}'
  });
  assert.equal(crossOrigin.status, 403);

  // SPA fallback route, manifest, icons, and 404 preservation
  const spaRes = await fetch(`${base}/papers/${paperA.id}`, { headers: { Accept: 'text/html' } });
  assert.equal(spaRes.status, 200);
  const spaHtml = await spaRes.text();
  assert.match(spaHtml, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(spaHtml, /apple-mobile-web-app-capable/);

  const manifestRes = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifestRes.status, 200);
  const manifest = await manifestRes.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.length >= 2);

  const iconRes = await fetch(`${base}/icons/icon-180.png`);
  assert.equal(iconRes.status, 200);
  assert.match(iconRes.headers.get('content-type'), /image\/png/);

  const missingApi = await fetch(`${base}/api/does-not-exist`, { headers: { Accept: 'text/html' } });
  assert.equal(missingApi.status, 404);
  const missingAsset = await fetch(`${base}/does-not-exist.js`, { headers: { Accept: 'text/html' } });
  assert.equal(missingAsset.status, 404);

  // Persistence across restart and cascade cleanup when a PDF file is removed
  await rm(storage.filePath(paperB.id));
  storage.db.close();
  await storage.init();
  const afterRestart = storage.getReadingState();
  assert.equal(afterRestart.lastPaperId, paperA.id);
  assert.equal(afterRestart.positions[paperB.id], undefined);
  assert.equal(afterRestart.positions[paperA.id].page, 4);
});
