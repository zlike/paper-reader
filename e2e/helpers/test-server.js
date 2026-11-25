import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '../../src/storage.js';
import { createApp } from '../../src/app.js';
import { createTestPdf } from './pdf-fixture.js';

export async function startTestServer() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'paper-reader-e2e-'));
  const storage = new Storage({
    dataDir,
    maxPdfBytes: 5 * 1024 * 1024,
    maxStorageBytes: 50 * 1024 * 1024
  });
  await storage.init();

  const citedPdf = createTestPdf([
    'Cited Paper Page 1: Transformers for Everyone',
    'Cited Paper Page 2: Experimental Results'
  ]);
  const exactDoiPdf = createTestPdf([
    'Exact DOI Paper Page 1: Deterministic Retrieval',
    'Exact DOI Paper Page 2: Conclusion'
  ]);

  const services = {
    searchCitation: async text => {
      const normalized = text.trim().toLowerCase();
      if (normalized.includes('10.1234/exact')) {
        const match = {
          id: 'W_EXACT',
          source: 'OPENALEX',
          title: 'Exact DOI Match Paper',
          authors: 'Ada Lovelace',
          year: 2025,
          doi: '10.1234/exact',
          pdfUrls: ['https://oa.example/exact.pdf']
        };
        return { candidates: [match], confident: match };
      }
      if (normalized.includes('transformer') || normalized.includes('attention')) {
        return {
          candidates: [
            {
              id: 'W_TRANS',
              source: 'OPENALEX',
              title: 'Transformers for Everyone',
              authors: 'Jane Researcher',
              year: 2024,
              doi: '10.1234/transformers',
              pdfUrls: ['https://oa.example/transformers.pdf']
            },
            {
              id: 'W_NOPDF',
              source: 'OPENALEX',
              title: 'Paywalled Transformer Survey',
              authors: 'John Smith',
              year: 2023,
              doi: '10.1234/paywalled',
              pdfUrls: []
            }
          ],
          confident: null
        };
      }
      return { candidates: [], confident: null };
    },
    getCandidate: async (_source, id) => {
      if (id === 'W_EXACT') {
        return {
          title: 'Exact DOI Match Paper',
          authors: 'Ada Lovelace',
          year: 2025,
          doi: '10.1234/exact',
          pdfUrls: ['https://oa.example/exact.pdf']
        };
      }
      return {
        title: 'Transformers for Everyone',
        authors: 'Jane Researcher',
        year: 2024,
        doi: '10.1234/transformers',
        pdfUrls: ['https://oa.example/transformers.pdf']
      };
    },
    downloadPdf: async (url, destination) => {
      const buf = url.includes('exact') ? exactDoiPdf : citedPdf;
      await writeFile(destination, buf);
    }
  };

  const app = createApp(storage, services);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function uploadPdf(title, pageTexts) {
    const buffer = createTestPdf(pageTexts);
    const form = new FormData();
    form.append('title', title);
    form.append('file', new Blob([buffer], { type: 'application/pdf' }), `${title}.pdf`);
    const response = await fetch(`${baseUrl}/api/papers`, { method: 'POST', body: form });
    if (!response.ok) {
      throw new Error(`Upload failed (${response.status})`);
    }
    return (await response.json()).paper;
  }

  async function close() {
    await new Promise(resolve => server.close(resolve));
    storage.db.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  return { baseUrl, storage, uploadPdf, close };
}
