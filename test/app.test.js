import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '../src/storage.js';
import { createApp } from '../src/app.js';
import { citationQuery, extractDoi, searchCitation, getCandidate } from '../src/citations.js';
import { downloadPdf, isPublicAddress } from '../src/download.js';

const pdf = Buffer.from('%PDF-1.4\nsample content\n%%EOF');
const pdf2 = Buffer.from('%PDF-1.4\nsecond sample!!\n%%EOF');
const pdf3 = Buffer.from('%PDF-1.4\nthird sample!!!\n%%EOF');
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
      return writeFile(destination, pdf2);
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
  const arxivDownload = await fetch(`${base}/api/citations/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'ARXIV', id: '2303.11366', pdfUrls: ['https://evil.invalid/x.pdf'] })
  });
  assert.equal(arxivDownload.status, 200);
  assert.equal((await arxivDownload.json()).existing, true);
  const full = await upload(pdf3, 'third-paper.pdf');
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
  const upload = async (filename, content = pdf) => {
    const body = new FormData();
    body.append('file', new Blob([content], { type: 'application/pdf' }), filename);
    const res = await fetch(`${base}/api/papers`, { method: 'POST', body });
    assert.equal(res.status, 201);
    return (await res.json()).paper;
  };

  const paperA = await upload('paper-a.pdf', pdf);
  const paperB = await upload('paper-b.pdf', pdf2);

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

test('startup dedup pass migrates legacy schema, keeps latest paper, merges metadata & reading state, removes orphaned PDFs, and is idempotent', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paper-reader-dedup-'));
  const filesDir = path.join(dir, 'papers');
  await mkdir(filesDir, { recursive: true });
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Simulate legacy SQLite DB before content_hash and arxiv_id columns existed
  const db = new DatabaseSync(path.join(dir, 'library.sqlite'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE papers (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, doi TEXT COLLATE NOCASE UNIQUE,
      size INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE reading_state (
      paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
      page INTEGER NOT NULL DEFAULT 1,
      offset REAL NOT NULL DEFAULT 0,
      zoom REAL,
      last_opened_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const insertPaper = db.prepare('INSERT INTO papers (id, title, doi, size, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertProgress = db.prepare(
    'INSERT INTO reading_state (paper_id, page, offset, zoom, last_opened_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  // Group 1: Duplicate by normalized title + arXiv DOI (older has DOI & newer reading_state, latest has null DOI)
  const g1OldPdf = Buffer.from('%PDF-1.4\ngroup1 old bytes\n%%EOF');
  const g1NewPdf = Buffer.from('%PDF-1.4\ngroup1 new bytes\n%%EOF');
  insertPaper.run('g1-old', 'Improving Factuality and Reasoning through Multiagent Debate', '10.48550/arXiv.2305.14325', g1OldPdf.length, '2026-10-01T10:00:00.000Z');
  insertPaper.run('g1-new', 'Improving Factuality and Reasoning Through Multiagent Debate!', null, g1NewPdf.length, '2026-10-05T10:00:00.000Z');
  await writeFile(path.join(filesDir, 'g1-old.pdf'), g1OldPdf);
  await writeFile(path.join(filesDir, 'g1-new.pdf'), g1NewPdf);
  insertProgress.run('g1-old', 7, 0.5, 1.5, '2026-10-06T12:00:00.000Z', '2026-10-06T12:00:00.000Z');

  // Group 2: Duplicate by identical SHA-256 content_hash (completely different titles, no DOIs)
  const g2Pdf = Buffer.from('%PDF-1.4\nidentical binary content for hash dedup\n%%EOF');
  insertPaper.run('g2-old', 'Downloaded Preprint Copy One', null, g2Pdf.length, '2026-10-02T10:00:00.000Z');
  insertPaper.run('g2-new', 'Renamed Final Version Copy Two', null, g2Pdf.length, '2026-10-03T10:00:00.000Z');
  await writeFile(path.join(filesDir, 'g2-old.pdf'), g2Pdf);
  await writeFile(path.join(filesDir, 'g2-new.pdf'), g2Pdf);
  insertProgress.run('g2-old', 3, 0.25, 1.25, '2026-10-07T08:00:00.000Z', '2026-10-07T08:00:00.000Z');
  insertProgress.run('g2-new', 1, 0.1, 1.0, '2026-10-04T08:00:00.000Z', '2026-10-04T08:00:00.000Z');

  // Unique paper that should remain untouched
  const uniquePdf = Buffer.from('%PDF-1.4\nunique paper bytes\n%%EOF');
  insertPaper.run('u1', 'Large Language Models are Zero-Shot Reasoners', '10.48550/arXiv.2205.11916', uniquePdf.length, '2026-10-01T08:00:00.000Z');
  await writeFile(path.join(filesDir, 'u1.pdf'), uniquePdf);
  db.close();

  const storage = new Storage({ dataDir: dir, maxPdfBytes: 1024 * 1024, maxStorageBytes: 10 * 1024 * 1024 });
  await storage.init();
  t.after(() => storage.db.close());

  const list = storage.list();
  assert.equal(list.length, 3);
  assert.deepEqual(list.map(p => p.id).sort(), ['g1-new', 'g2-new', 'u1']);

  // Group 1 keeper preserved DOI, backfilled arxiv_id, and inherited reading_state from g1-old
  const g1Row = storage.db.prepare('SELECT doi, arxiv_id, content_hash FROM papers WHERE id = ?').get('g1-new');
  assert.equal(g1Row.doi, '10.48550/arXiv.2305.14325');
  assert.equal(g1Row.arxiv_id, '2305.14325');
  assert.ok(g1Row.content_hash && g1Row.content_hash.length === 64);
  const g1Progress = storage.getPaperProgress('g1-new');
  assert.equal(g1Progress.page, 7);
  assert.equal(g1Progress.zoom, 1.5);

  // Group 2 keeper inherited more-recently-opened reading_state from g2-old
  const g2Progress = storage.getPaperProgress('g2-new');
  assert.equal(g2Progress.page, 3);
  assert.equal(g2Progress.zoom, 1.25);

  // Orphaned PDF files for removed duplicates were deleted from disk
  await assert.rejects(() => access(path.join(filesDir, 'g1-old.pdf')), { code: 'ENOENT' });
  await assert.rejects(() => access(path.join(filesDir, 'g2-old.pdf')), { code: 'ENOENT' });
  await access(path.join(filesDir, 'g1-new.pdf'));
  await access(path.join(filesDir, 'g2-new.pdf'));
  await access(path.join(filesDir, 'u1.pdf'));

  // Idempotent on re-init
  storage.db.close();
  await storage.init();
  assert.deepEqual(storage.list().map(p => p.id).sort(), ['g1-new', 'g2-new', 'u1']);
  assert.equal(storage.getPaperProgress('g1-new').page, 7);
  assert.equal(storage.getPaperProgress('g2-new').page, 3);
});

test('multi-key duplicate prevention, search existingPaperId annotation, and DELETE /api/papers/:id', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paper-reader-multi-dedup-'));
  const storage = new Storage({ dataDir: dir, maxPdfBytes: 1024 * 1024, maxStorageBytes: 10 * 1024 * 1024 });
  await storage.init();

  let downloadCalls = 0;
  const arxivPdf = Buffer.from('%PDF-1.4\narxiv multiagent debate pdf\n%%EOF');
  const otherPdf = Buffer.from('%PDF-1.4\nanother distinct paper pdf\n%%EOF');

  const services = {
    searchCitation: async () => ({
      candidates: [
        {
          id: '2305.14325v2',
          source: 'ARXIV',
          title: 'Improving Factuality and Reasoning through Multiagent Debate',
          doi: null,
          arxivId: '2305.14325',
          pdfUrls: ['https://arxiv.org/pdf/2305.14325v2.pdf']
        },
        {
          id: 'W999',
          source: 'OPENALEX',
          title: 'Brand New Unseen Paper Title',
          doi: '10.9999/unseen',
          pdfUrls: ['https://example.org/unseen.pdf']
        }
      ],
      confident: {
        id: '2305.14325v2',
        source: 'ARXIV',
        title: 'Improving Factuality and Reasoning through Multiagent Debate',
        doi: null,
        arxivId: '2305.14325',
        pdfUrls: ['https://arxiv.org/pdf/2305.14325v2.pdf']
      }
    }),
    getCandidate: async (source, id) => {
      if (source === 'ARXIV' && id.startsWith('2305.14325')) {
        return {
          id,
          source: 'ARXIV',
          title: 'Improving Factuality and Reasoning through Multiagent Debate',
          doi: null,
          arxivId: '2305.14325',
          pdfUrls: [`https://arxiv.org/pdf/${id}.pdf`]
        };
      }
      if (source === 'OPENALEX' && id === 'W_TITLE_DUP') {
        return {
          id,
          source: 'OPENALEX',
          title: 'Improving Factuality and Reasoning Through Multiagent Debate!',
          doi: null,
          pdfUrls: ['https://example.org/dup-title.pdf']
        };
      }
      return {
        id,
        source,
        title: 'Brand New Unseen Paper Title',
        doi: '10.9999/unseen',
        pdfUrls: ['https://example.org/unseen.pdf']
      };
    },
    downloadPdf: async (_url, destination) => {
      downloadCalls += 1;
      await writeFile(destination, downloadCalls === 1 ? arxivPdf : otherPdf);
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

  // 1. Download arXiv v1 -> creates paper
  const firstRes = await fetch(`${base}/api/citations/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'ARXIV', id: '2305.14325v1' })
  });
  assert.equal(firstRes.status, 201);
  const firstBody = await firstRes.json();
  assert.equal(firstBody.existing, false);
  assert.equal(downloadCalls, 1);

  // 2. Download arXiv v2 -> pre-download dedup catches it WITHOUT calling downloadPdf
  const v2Res = await fetch(`${base}/api/citations/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'ARXIV', id: '2305.14325v2' })
  });
  assert.equal(v2Res.status, 200);
  const v2Body = await v2Res.json();
  assert.equal(v2Body.existing, true);
  assert.equal(v2Body.paper.id, firstBody.paper.id);
  assert.equal(downloadCalls, 1);

  // 3. Download via different source with normalized title match -> pre-download dedup catches it WITHOUT calling downloadPdf
  const titleDupRes = await fetch(`${base}/api/citations/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'OPENALEX', id: 'W_TITLE_DUP' })
  });
  assert.equal(titleDupRes.status, 200);
  const titleDupBody = await titleDupRes.json();
  assert.equal(titleDupBody.existing, true);
  assert.equal(titleDupBody.paper.id, firstBody.paper.id);
  assert.equal(downloadCalls, 1);

  // 4. Manual upload of identical PDF bytes with a different title -> SHA-256 content_hash dedup returns existing
  const form = new FormData();
  form.append('title', 'Completely Different Uploaded Filename');
  form.append('file', new Blob([arxivPdf], { type: 'application/pdf' }), 'copy.pdf');
  const uploadDupRes = await fetch(`${base}/api/papers`, { method: 'POST', body: form });
  assert.equal(uploadDupRes.status, 200);
  const uploadDupBody = await uploadDupRes.json();
  assert.equal(uploadDupBody.existing, true);
  assert.equal(uploadDupBody.paper.id, firstBody.paper.id);
  assert.equal(storage.list().length, 1);

  // 5. /api/citations/search annotates existingPaperId
  const searchRes = await fetch(`${base}/api/citations/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Multiagent Debate' })
  });
  assert.equal(searchRes.status, 200);
  const searchBody = await searchRes.json();
  assert.equal(searchBody.confident.existingPaperId, firstBody.paper.id);
  assert.equal(searchBody.candidates[0].existingPaperId, firstBody.paper.id);
  assert.equal(searchBody.candidates[1].existingPaperId, null);

  // 6. Save reading progress, then DELETE /api/papers/:id -> 200, removes file & reading_state
  await fetch(`${base}/api/papers/${firstBody.paper.id}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 2, offset: 0.3 })
  });
  const delRes = await fetch(`${base}/api/papers/${firstBody.paper.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
  assert.deepEqual(await delRes.json(), { deleted: true, id: firstBody.paper.id });
  assert.equal(storage.list().length, 0);
  assert.equal(storage.getPaperProgress(firstBody.paper.id), undefined);
  await assert.rejects(() => access(storage.filePath(firstBody.paper.id)), { code: 'ENOENT' });

  // 7. Deleting again or nonexistent ID returns 404
  const delMissing = await fetch(`${base}/api/papers/${firstBody.paper.id}`, { method: 'DELETE' });
  assert.equal(delMissing.status, 404);
  assert.deepEqual(await delMissing.json(), { error: 'Paper not found' });
});
