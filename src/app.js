import express from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { searchCitation, getCandidate } from './citations.js';
import { downloadPdf } from './download.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, 'dist');
const publicDir = path.join(root, 'public');
const webDir = path.join(root, 'web');

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
  app.use(express.static(distDir));
  app.use(express.static(publicDir));

  app.get('/api/papers', (_req, res) => res.json({
    papers: storage.list(),
    readingState: storage.getReadingState()
  }));
  app.get('/api/reading-state', (_req, res) => res.json(storage.getReadingState()));
  const saveProgress = (req, res) => {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Invalid reading progress payload' });
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Invalid reading progress payload' });
    }
    const { page, offset, zoom, opened } = body;
    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      return res.status(400).json({ error: 'Page must be a positive integer' });
    }
    if (offset !== undefined && (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0 || offset > 1)) {
      return res.status(400).json({ error: 'Offset must be a number between 0 and 1' });
    }
    if (zoom !== undefined && zoom !== null && (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0.5 || zoom > 4)) {
      return res.status(400).json({ error: 'Zoom must be a number between 0.5 and 4' });
    }
    if (opened !== undefined && typeof opened !== 'boolean') {
      return res.status(400).json({ error: 'Opened must be a boolean' });
    }
    const progress = storage.saveReadingProgress(req.params.id, { page, offset, zoom, opened });
    if (!progress) return res.status(404).json({ error: 'Paper not found' });
    res.json({ progress });
  };
  app.put('/api/papers/:id/progress', saveProgress);
  app.post('/api/papers/:id/progress', express.text({ type: 'text/plain', limit: '4kb' }), saveProgress);
  app.get('/api/papers/:id/file', (req, res, next) => {
    if (!storage.get(req.params.id)) return res.status(404).json({ error: 'Paper not found' });
    res.type('application/pdf').sendFile(storage.filePath(req.params.id), error => {
      if (error) next(error);
    });
  });
  app.delete('/api/papers/:id', wrap(async (req, res) => {
    const deleted = await storage.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Paper not found' });
    res.json({ deleted: true, id: req.params.id });
  }));
  app.post('/api/papers', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a PDF file' });
    try {
      const title = typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title : req.file.originalname.replace(/\.pdf$/i, '');
      const result = await storage.save(req.file.path, { title });
      res.status(result.existing ? 200 : 201).json(result);
    } finally {
      await storage.removeTemp(req.file.path);
    }
  }));
  const candidateLookupKey = (candidate, fallbackSource = null, fallbackId = null) => {
    const source = candidate?.source || fallbackSource;
    const id = candidate?.id || fallbackId;
    const arxivId = candidate?.arxivId || (source === 'ARXIV' ? id : null);
    return {
      doi: candidate?.doi || null,
      title: candidate?.title || null,
      arxivId
    };
  };
  app.post('/api/citations/search', wrap(async (req, res) => {
    if (typeof req.body?.text !== 'string' || !req.body.text.trim() || req.body.text.length > 4000) {
      return res.status(400).json({ error: 'Select citation text up to 4,000 characters' });
    }
    const result = await search(req.body.text);
    // PDF URLs are never accepted from the browser; each download is re-resolved by identifier.
    const publicCandidate = ({ pdfUrls, ...candidate }) => {
      const existing = storage.findExisting(candidateLookupKey(candidate));
      return {
        ...candidate,
        hasPdf: pdfUrls.length > 0,
        existingPaperId: existing ? existing.id : null
      };
    };
    res.json({
      candidates: result.candidates.map(publicCandidate),
      confident: result.confident ? publicCandidate(result.confident) : null,
      providers: Array.isArray(result.providers) ? result.providers : []
    });
  }));
  app.post('/api/citations/download', wrap(async (req, res) => {
    if (typeof req.body?.source !== 'string' || typeof req.body?.id !== 'string') {
      return res.status(400).json({ error: 'A paper identifier is required' });
    }
    const candidate = await lookup(req.body.source, req.body.id);
    const lookupKey = candidateLookupKey(candidate, req.body.source, req.body.id);
    const existing = storage.findExisting(lookupKey);
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
      const result = await storage.save(temp, { ...candidate, arxivId: lookupKey.arxivId });
      res.status(result.existing ? 200 : 201).json(result);
    } finally {
      await storage.removeTemp(temp);
    }
  }));
  app.get('*', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/') || req.path.startsWith('/vendor/')) return next();
    if (!req.path.startsWith('/papers/') && path.extname(req.path)) return next();
    if (!req.accepts('html')) return next();
    const indexPath = existsSync(path.join(distDir, 'index.html'))
      ? path.join(distDir, 'index.html')
      : path.join(webDir, 'index.html');
    res.sendFile(indexPath, error => {
      if (error) next(error);
    });
  });
  app.use((error, _req, res, _next) => {
    console.error(error);
    if (res.headersSent) return;
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'PDF exceeds the file size limit' : error.message;
    res.status(error.type === 'entity.too.large' || error instanceof multer.MulterError ? 400 : 500)
      .json({ error: message || 'An unexpected error occurred' });
  });
  return app;
}
