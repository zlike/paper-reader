import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { access, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

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
    for (const name of await readdir(this.tmpDir)) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) {
        await rm(path.join(this.tmpDir, name), { force: true });
      }
    }
  }

  list() {
    return this.db.prepare('SELECT id, title, doi, size, created_at FROM papers ORDER BY created_at DESC').all();
  }

  get(id) {
    return this.db.prepare('SELECT id, title, doi, size, created_at FROM papers WHERE id = ?').get(id);
  }

  findDoi(doi) {
    return doi ? this.db.prepare('SELECT id, title, doi, size, created_at FROM papers WHERE doi = ?').get(doi) : undefined;
  }

  filePath(id) {
    return path.join(this.filesDir, `${id}.pdf`);
  }

  async save(tempPath, { title, doi = null }) {
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

    // The quota check and database insertion are synchronous, preventing concurrent commits from exceeding the limit.
    const existing = this.findDoi(doi);
    if (existing) return { paper: existing, existing: true };
    const used = this.db.prepare('SELECT COALESCE(SUM(size), 0) AS size FROM papers').get().size;
    if (used + info.size > this.maxStorageBytes) throw new Error('Library storage limit reached');
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const paper = { id, title: title.trim().slice(0, 500) || 'Untitled paper', doi, size: info.size, created_at: createdAt };
    // Reserve the space before awaiting the move. Failed moves remove their reservation.
    this.db.prepare('INSERT INTO papers (id, title, doi, size, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, paper.title, doi, info.size, createdAt);
    try {
      await rename(tempPath, this.filePath(id));
    } catch (error) {
      this.db.prepare('DELETE FROM papers WHERE id = ?').run(id);
      throw error;
    }
    return { paper, existing: false };
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
