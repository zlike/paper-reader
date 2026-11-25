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
