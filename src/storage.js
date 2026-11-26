import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export function normalizeDoi(doi) {
  if (typeof doi !== 'string') return null;
  const cleaned = doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;)\]]+$/, '')
    .trim()
    .toLowerCase();
  return cleaned || null;
}

export function normalizeArxivId(arxivId) {
  if (typeof arxivId !== 'string') return null;
  const cleaned = arxivId
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/^arxiv:\s*/i, '')
    .replace(/\.pdf$/i, '')
    .replace(/v\d+$/i, '')
    .trim()
    .toLowerCase();
  return cleaned || null;
}

export function extractArxivIdFromDoi(doi) {
  const norm = normalizeDoi(doi);
  if (!norm) return null;
  const match = norm.match(/^10\.48550\/arxiv\.(.+)$/i);
  return match ? normalizeArxivId(match[1]) : null;
}

export function normalizeTitle(title) {
  if (typeof title !== 'string') return null;
  const normalized = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length < 10 || normalized === 'untitled paper') return null;
  return normalized;
}

async function computeFileHash(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

function parseTimestamp(value) {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function comparePapersNewestFirst(a, b) {
  const timeDiff = parseTimestamp(b.created_at) - parseTimestamp(a.created_at);
  if (timeDiff !== 0) return timeDiff;
  const strDiff = String(b.created_at || '').localeCompare(String(a.created_at || ''));
  if (strDiff !== 0) return strDiff;
  return String(b.id || '').localeCompare(String(a.id || ''));
}

function isMoreRecentReadingState(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  const openDiff = parseTimestamp(candidate.last_opened_at) - parseTimestamp(current.last_opened_at);
  if (openDiff !== 0) return openDiff > 0;
  return parseTimestamp(candidate.updated_at) > parseTimestamp(current.updated_at);
}

export class Storage {
  constructor({ dataDir, maxPdfBytes, maxStorageBytes }) {
    this.dataDir = dataDir;
    this.filesDir = path.join(dataDir, 'papers');
    this.tmpDir = path.join(dataDir, 'tmp');
    this.maxPdfBytes = maxPdfBytes;
    this.maxStorageBytes = maxStorageBytes;
  }

  async init() {
    await mkdir(this.filesDir, { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dataDir, 'library.sqlite'));
    this.db.exec(`PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, doi TEXT COLLATE NOCASE UNIQUE,
        size INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reading_state (
        paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
        page INTEGER NOT NULL DEFAULT 1,
        offset REAL NOT NULL DEFAULT 0,
        zoom REAL,
        last_opened_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
    this._migrateSchema();
    for (const paper of this.list()) {
      try {
        await access(this.filePath(paper.id));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        console.error(`Removing missing PDF record ${paper.id}`);
        this.db.prepare('DELETE FROM papers WHERE id = ?').run(paper.id);
      }
    }
    this.db.prepare('DELETE FROM reading_state WHERE paper_id NOT IN (SELECT id FROM papers)').run();
    await this._backfillMetadata();
    await this._deduplicateExisting();
    for (const name of await readdir(this.tmpDir)) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) {
        await rm(path.join(this.tmpDir, name), { force: true });
      }
    }
  }

  _migrateSchema() {
    const columns = new Set(
      this.db.prepare('PRAGMA table_info(papers)').all().map(col => col.name)
    );
    if (!columns.has('content_hash')) {
      this.db.exec('ALTER TABLE papers ADD COLUMN content_hash TEXT');
    }
    if (!columns.has('arxiv_id')) {
      this.db.exec('ALTER TABLE papers ADD COLUMN arxiv_id TEXT');
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_papers_content_hash ON papers(content_hash);
      CREATE INDEX IF NOT EXISTS idx_papers_arxiv_id ON papers(arxiv_id);
    `);
  }

  async _backfillMetadata() {
    const rows = this.db.prepare(
      'SELECT id, doi, arxiv_id, content_hash FROM papers WHERE content_hash IS NULL OR arxiv_id IS NULL'
    ).all();
    const updateHash = this.db.prepare('UPDATE papers SET content_hash = ? WHERE id = ?');
    const updateArxiv = this.db.prepare('UPDATE papers SET arxiv_id = ? WHERE id = ?');
    for (const row of rows) {
      if (!row.content_hash) {
        const hash = await computeFileHash(this.filePath(row.id));
        updateHash.run(hash, row.id);
      }
      if (!row.arxiv_id && row.doi) {
        const arxivId = extractArxivIdFromDoi(row.doi);
        if (arxivId) {
          updateArxiv.run(arxivId, row.id);
        }
      }
    }
  }

  async _deduplicateExisting() {
    const rows = this.db.prepare(
      'SELECT id, title, doi, arxiv_id, content_hash, size, created_at FROM papers'
    ).all();
    if (rows.length <= 1) return;

    const parent = rows.map((_, i) => i);
    const find = i => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    const byKey = new Map();
    const link = (key, idx) => {
      if (!key) return;
      const prev = byKey.get(key);
      if (prev !== undefined) union(prev, idx);
      else byKey.set(key, idx);
    };

    rows.forEach((row, idx) => {
      const doi = normalizeDoi(row.doi);
      const arxivId = normalizeArxivId(row.arxiv_id) || extractArxivIdFromDoi(row.doi);
      const title = normalizeTitle(row.title);
      const hash = row.content_hash ? row.content_hash.toLowerCase() : null;
      if (doi) link(`doi:${doi}`, idx);
      if (arxivId) link(`arxiv:${arxivId}`, idx);
      if (title) link(`title:${title}`, idx);
      if (hash) link(`hash:${hash}`, idx);
    });

    const groups = new Map();
    rows.forEach((row, idx) => {
      const root = find(idx);
      let group = groups.get(root);
      if (!group) {
        group = [];
        groups.set(root, group);
      }
      group.push(row);
    });

    const filesToDelete = [];
    const deletePaperStmt = this.db.prepare('DELETE FROM papers WHERE id = ?');
    const updateKeeperStmt = this.db.prepare(
      'UPDATE papers SET doi = ?, arxiv_id = ?, content_hash = ? WHERE id = ?'
    );
    const upsertProgressStmt = this.db.prepare(`
      INSERT INTO reading_state (paper_id, page, offset, zoom, last_opened_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(paper_id) DO UPDATE SET
        page = excluded.page,
        offset = excluded.offset,
        zoom = excluded.zoom,
        last_opened_at = excluded.last_opened_at,
        updated_at = excluded.updated_at
    `);

    for (const members of groups.values()) {
      if (members.length <= 1) continue;
      members.sort(comparePapersNewestFirst);
      const keeper = members[0];
      const duplicates = members.slice(1);

      const mergedDoi = keeper.doi || duplicates.find(d => d.doi)?.doi || null;
      const mergedArxivId = keeper.arxiv_id
        || duplicates.find(d => d.arxiv_id)?.arxiv_id
        || extractArxivIdFromDoi(mergedDoi)
        || null;
      const mergedHash = keeper.content_hash || duplicates.find(d => d.content_hash)?.content_hash || null;

      let bestProgress = this.getPaperProgress(keeper.id) || null;
      let progressFromDuplicate = false;
      for (const dup of duplicates) {
        const dupProgress = this.getPaperProgress(dup.id);
        if (isMoreRecentReadingState(dupProgress, bestProgress)) {
          bestProgress = dupProgress;
          progressFromDuplicate = true;
        }
      }

      this.db.exec('BEGIN');
      try {
        for (const dup of duplicates) {
          deletePaperStmt.run(dup.id);
        }
        if (mergedDoi !== keeper.doi || mergedArxivId !== keeper.arxiv_id || mergedHash !== keeper.content_hash) {
          updateKeeperStmt.run(mergedDoi, mergedArxivId, mergedHash, keeper.id);
        }
        if (progressFromDuplicate && bestProgress) {
          upsertProgressStmt.run(
            keeper.id,
            bestProgress.page,
            bestProgress.offset,
            bestProgress.zoom,
            bestProgress.last_opened_at,
            bestProgress.updated_at
          );
        }
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }

      for (const dup of duplicates) {
        filesToDelete.push(this.filePath(dup.id));
      }
    }

    for (const file of filesToDelete) {
      await rm(file, { force: true });
    }
  }

  list() {
    return this.db.prepare('SELECT id, title, doi, size, created_at FROM papers ORDER BY created_at DESC').all();
  }

  get(id) {
    return this.db.prepare('SELECT id, title, doi, size, created_at FROM papers WHERE id = ?').get(id);
  }

  findDoi(doi) {
    const norm = normalizeDoi(doi);
    return norm ? this.findExisting({ doi: norm }) : undefined;
  }

  findExisting({ doi = null, title = null, arxivId = null, contentHash = null } = {}) {
    const normDoi = normalizeDoi(doi);
    const normArxiv = normalizeArxivId(arxivId) || extractArxivIdFromDoi(normDoi);
    const normTitle = normalizeTitle(title);
    const normHash = typeof contentHash === 'string' && contentHash.trim()
      ? contentHash.trim().toLowerCase()
      : null;

    if (!normDoi && !normArxiv && !normTitle && !normHash) return undefined;

    if (normDoi) {
      const direct = this.db.prepare(
        'SELECT id, title, doi, size, created_at FROM papers WHERE doi = ? ORDER BY created_at DESC LIMIT 1'
      ).get(normDoi);
      if (direct) return direct;
    }

    if (normArxiv) {
      const direct = this.db.prepare(
        'SELECT id, title, doi, size, created_at FROM papers WHERE LOWER(arxiv_id) = ? ORDER BY created_at DESC LIMIT 1'
      ).get(normArxiv);
      if (direct) return direct;
    }

    if (normHash) {
      const direct = this.db.prepare(
        'SELECT id, title, doi, size, created_at FROM papers WHERE LOWER(content_hash) = ? ORDER BY created_at DESC LIMIT 1'
      ).get(normHash);
      if (direct) return direct;
    }

    const rows = this.db.prepare(
      'SELECT id, title, doi, arxiv_id, content_hash, size, created_at FROM papers ORDER BY created_at DESC, id DESC'
    ).all();

    for (const row of rows) {
      const matchDoi = normDoi && normalizeDoi(row.doi) === normDoi;
      const matchArxiv = normArxiv && (
        normalizeArxivId(row.arxiv_id) === normArxiv ||
        extractArxivIdFromDoi(row.doi) === normArxiv
      );
      const matchHash = normHash && row.content_hash?.toLowerCase() === normHash;
      const matchTitle = normTitle && normalizeTitle(row.title) === normTitle;
      if (matchDoi || matchArxiv || matchHash || matchTitle) {
        return {
          id: row.id,
          title: row.title,
          doi: row.doi,
          size: row.size,
          created_at: row.created_at
        };
      }
    }
    return undefined;
  }

  filePath(id) {
    return path.join(this.filesDir, `${id}.pdf`);
  }

  async save(tempPath, { title, doi = null, arxivId = null } = {}) {
    const info = await stat(tempPath);
    if (!info.size || info.size > this.maxPdfBytes) throw new Error('PDF exceeds the file size limit or is empty');
    const file = await open(tempPath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(info.size, 1024));
      await file.read(buffer, 0, buffer.length, 0);
      if (!buffer.includes(Buffer.from('%PDF-'))) throw new Error('The file is not a valid PDF');
    } finally {
      await file.close();
    }

    const contentHash = await computeFileHash(tempPath);
    const normDoi = normalizeDoi(doi);
    const normArxiv = normalizeArxivId(arxivId) || extractArxivIdFromDoi(normDoi);

    // The quota check and database insertion are synchronous, preventing concurrent commits from exceeding the limit.
    const existing = this.findExisting({ doi: normDoi, title, arxivId: normArxiv, contentHash });
    if (existing) return { paper: existing, existing: true };
    const used = this.db.prepare('SELECT COALESCE(SUM(size), 0) AS size FROM papers').get().size;
    if (used + info.size > this.maxStorageBytes) throw new Error('Library storage limit reached');
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const paper = {
      id,
      title: title.trim().slice(0, 500) || 'Untitled paper',
      doi: normDoi,
      size: info.size,
      created_at: createdAt
    };
    // Reserve the space before awaiting the move. Failed moves remove their reservation.
    this.db.prepare(
      'INSERT INTO papers (id, title, doi, arxiv_id, content_hash, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, paper.title, normDoi, normArxiv, contentHash, info.size, createdAt);
    try {
      await rename(tempPath, this.filePath(id));
    } catch (error) {
      this.db.prepare('DELETE FROM papers WHERE id = ?').run(id);
      throw error;
    }
    return { paper, existing: false };
  }

  async delete(id) {
    const result = this.db.prepare('DELETE FROM papers WHERE id = ?').run(id);
    if (!result.changes) return false;
    await rm(this.filePath(id), { force: true });
    return true;
  }

  async removeTemp(file) {
    if (file) await rm(file, { force: true });
  }

  getPaperProgress(paperId) {
    return this.db.prepare(
      'SELECT paper_id, page, offset, zoom, last_opened_at, updated_at FROM reading_state WHERE paper_id = ?'
    ).get(paperId);
  }

  getReadingState() {
    const rows = this.db.prepare(`
      SELECT r.paper_id, r.page, r.offset, r.zoom, r.last_opened_at, r.updated_at
      FROM reading_state r
      JOIN papers p ON p.id = r.paper_id
      ORDER BY r.last_opened_at DESC, r.updated_at DESC
    `).all();
    const positions = {};
    for (const row of rows) {
      positions[row.paper_id] = {
        page: row.page,
        offset: row.offset,
        zoom: row.zoom,
        last_opened_at: row.last_opened_at,
        updated_at: row.updated_at
      };
    }
    return { lastPaperId: rows[0]?.paper_id ?? null, positions };
  }

  saveReadingProgress(paperId, { page, offset, zoom, opened } = {}) {
    if (!this.get(paperId)) return null;
    const existing = this.getPaperProgress(paperId);
    const nextPage = Number.isInteger(page) && page >= 1 ? page : (existing?.page ?? 1);
    const nextOffset = typeof offset === 'number' && Number.isFinite(offset)
      ? Math.max(0, Math.min(1, offset))
      : (existing?.offset ?? 0);
    const nextZoom = zoom === null
      ? null
      : (typeof zoom === 'number' && Number.isFinite(zoom)
        ? Math.max(0.5, Math.min(4, zoom))
        : (existing?.zoom ?? null));
    const now = new Date().toISOString();
    const lastOpenedAt = opened === false && existing ? existing.last_opened_at : now;
    this.db.prepare(`
      INSERT INTO reading_state (paper_id, page, offset, zoom, last_opened_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(paper_id) DO UPDATE SET
        page = excluded.page,
        offset = excluded.offset,
        zoom = excluded.zoom,
        last_opened_at = excluded.last_opened_at,
        updated_at = excluded.updated_at
    `).run(paperId, nextPage, nextOffset, nextZoom, lastOpenedAt, now);
    return {
      paper_id: paperId,
      page: nextPage,
      offset: nextOffset,
      zoom: nextZoom,
      last_opened_at: lastOpenedAt,
      updated_at: now
    };
  }
}
