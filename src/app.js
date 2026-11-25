import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { searchCitation, getCandidate } from './citations.js';
import { downloadPdf } from './download.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createApp(storage, services = {}) {
  const app = express();
  const search = services.searchCitation || searchCitation;
  const lookup = services.getCandidate || getCandidate;
  const download = services.downloadPdf || downloadPdf;
  const upload = multer({
    storage: multer.diskStorage({
      destination: storage.tmpDir,
      filename: (_req, _file, cb) => cb(null, randomUUID())
    }),
    limits: { fileSize: storage.maxPdfBytes, files: 1, fields: 2 }
  });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
      try {
        const origin = new URL(req.get('origin'));
        if (origin.host !== req.get('host') || origin.protocol !== `${req.protocol}:`) return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
      } catch {
        return res.status(403).json({ error: 'Invalid request origin' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/vendor/pdfjs', express.static(path.join(root, 'node_modules', 'pdfjs-dist'), { fallthrough: false }));
  app.use(express.static(path.join(root, 'public')));

  app.get('/api/papers', (_req, res) => res.json({ papers: storage.list() }));
  app.get('/api/papers/:id/file', (req, res, next) => {
    if (!storage.get(req.params.id)) return res.status(404).json({ error: 'Paper not found' });
    res.type('application/pdf').sendFile(storage.filePath(req.params.id), error => {
      if (error) next(error);
    });
  });
  app.post('/api/papers', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a PDF file' });
    try {
      const title = typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title : req.file.originalname.replace(/\.pdf$/i, '');
      const result = await storage.save(req.file.path, { title });
      res.status(201).json(result);
    } finally {
      await storage.removeTemp(req.file.path);
    }
  }));
  app.post('/api/citations/search', wrap(async (req, res) => {
    if (typeof req.body?.text !== 'string' || !req.body.text.trim() || req.body.text.length > 4000) {
      return res.status(400).json({ error: 'Select citation text up to 4,000 characters' });
    }
    const result = await search(req.body.text);
    // PDF URLs are never accepted from the browser; each download is re-resolved by identifier.
    const publicCandidate = ({ pdfUrls, ...candidate }) => ({ ...candidate, hasPdf: pdfUrls.length > 0 });
    res.json({
      candidates: result.candidates.map(publicCandidate),
      confident: result.confident ? publicCandidate(result.confident) : null
    });
  }));
  app.post('/api/citations/download', wrap(async (req, res) => {
    if (typeof req.body?.source !== 'string' || typeof req.body?.id !== 'string') {
      return res.status(400).json({ error: 'A paper identifier is required' });
    }
    const candidate = await lookup(req.body.source, req.body.id);
    const existing = storage.findDoi(candidate.doi);
    if (existing) return res.json({ paper: existing, existing: true });
    if (!candidate.pdfUrls.length) return res.status(404).json({ error: 'No open-access PDF is available for this paper' });
    const temp = path.join(storage.tmpDir, randomUUID());
    try {
      let lastError;
      let downloaded = false;
      for (const url of candidate.pdfUrls) {
        try {
          await download(url, temp, storage.maxPdfBytes);
          downloaded = true;
          break;
        } catch (error) {
          lastError = error;
          await storage.removeTemp(temp);
        }
      }
      if (!downloaded) throw new Error(`Could not download an open-access PDF: ${lastError.message}`);
      const result = await storage.save(temp, candidate);
      res.status(result.existing ? 200 : 201).json(result);
    } finally {
      await storage.removeTemp(temp);
    }
  }));
  app.use((error, _req, res, _next) => {
    console.error(error);
    if (res.headersSent) return;
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'PDF exceeds the file size limit' : error.message;
    res.status(error.type === 'entity.too.large' || error instanceof multer.MulterError ? 400 : 500)
      .json({ error: message || 'An unexpected error occurred' });
  });
  return app;
}
