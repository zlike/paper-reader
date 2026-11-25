import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  categorizePapers,
  computeReadingPosition,
  computeScrollTop,
  formatPaperTimestamp,
  loadLocalReadingState,
  mergeReadingStates,
  normalizeZoom,
  paperIdFromPath,
  paperPath,
  saveLocalReadingState
} from '../public/reading-progress.js';

test('paper path parsing and formatting handle encoded IDs and non-paper routes', () => {
  assert.equal(paperPath('abc-123'), '/papers/abc-123');
  assert.equal(paperPath(null), '/');
  assert.equal(paperIdFromPath('/papers/abc-123'), 'abc-123');
  assert.equal(paperIdFromPath('/papers/abc-123/'), 'abc-123');
  assert.equal(paperIdFromPath('/papers/a%20b'), 'a b');
  assert.equal(paperIdFromPath('/'), null);
  assert.equal(paperIdFromPath('/api/papers/abc-123'), null);
  assert.equal(paperIdFromPath('/papers/%E0%A4%A'), null);
});

test('viewport-independent reading position computes and restores across screen sizes', () => {
  const desktopPages = [
    { page: 1, top: 16, height: 1000 },
    { page: 2, top: 1032, height: 1000 },
    { page: 3, top: 2048, height: 1000 }
  ];
  // Top of document
  assert.deepEqual(computeReadingPosition(desktopPages, 0), { page: 1, offset: 0 });
  assert.equal(computeScrollTop(desktopPages, { page: 1, offset: 0 }), 0);

  // Midway through page 2 on desktop -> restore on narrower mobile layout
  const pos = computeReadingPosition(desktopPages, 1532);
  assert.deepEqual(pos, { page: 2, offset: 0.5 });

  const mobilePages = [
    { page: 1, top: 8, height: 500 },
    { page: 2, top: 516, height: 500 },
    { page: 3, top: 1024, height: 500 }
  ];
  assert.equal(computeScrollTop(mobilePages, pos), 766);

  // Scroll position inside the gap between page 1 and page 2 maps to start of page 2
  assert.deepEqual(computeReadingPosition(desktopPages, 1024), { page: 2, offset: 0 });

  // Past end of document clamps to last page offset 1
  assert.deepEqual(computeReadingPosition(desktopPages, 5000), { page: 3, offset: 1 });

  // Out-of-bounds saved page clamps safely to last page
  assert.equal(computeScrollTop(mobilePages, { page: 99, offset: 0.5 }), 1274);
});

test('mergeReadingStates reconciles server and local cache and drops missing papers', () => {
  const server = {
    lastPaperId: 'p1',
    positions: {
      p1: { page: 5, offset: 0.2, zoom: 1, last_opened_at: '2026-11-25T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z' },
      p2: { page: 2, offset: 0.3, zoom: 1.25, last_opened_at: '2026-11-25T09:00:00.000Z', updated_at: '2026-11-25T09:00:00.000Z' },
      deleted: { page: 1, offset: 0, zoom: 1, last_opened_at: '2026-11-25T12:00:00.000Z', updated_at: '2026-11-25T12:00:00.000Z' }
    }
  };
  const local = {
    lastPaperId: 'p2',
    positions: {
      p1: { page: 1, offset: 0, zoom: 1, last_opened_at: '2026-11-25T08:00:00.000Z', updated_at: '2026-11-25T08:00:00.000Z' },
      p2: { page: 6, offset: 0.8, zoom: 1.5, last_opened_at: '2026-11-25T11:00:00.000Z', updated_at: '2026-11-25T11:00:00.000Z' }
    }
  };

  const merged = mergeReadingStates(server, local, new Set(['p1', 'p2']));
  assert.equal(merged.positions.deleted, undefined);
  assert.equal(merged.positions.p1.page, 5); // server is newer
  assert.equal(merged.positions.p2.page, 6); // local is newer
  assert.equal(merged.lastPaperId, 'p2');    // p2 has latest last_opened_at among valid papers
});

test('localStorage helpers and zoom normalization handle edge cases', () => {
  const store = new Map();
  const mockStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value)
  };
  saveLocalReadingState({ lastPaperId: 'p1', positions: { p1: { page: 2, offset: 0.4 } } }, mockStorage);
  assert.deepEqual(loadLocalReadingState(mockStorage), {
    lastPaperId: 'p1',
    positions: { p1: { page: 2, offset: 0.4 } }
  });
  store.set(STORAGE_KEY, '{not json');
  assert.deepEqual(loadLocalReadingState(mockStorage), { lastPaperId: null, positions: {} });

  assert.equal(normalizeZoom(1.25), 1.25);
  assert.equal(normalizeZoom(5), 2.5);
  assert.equal(normalizeZoom(0.2), 1);
  assert.equal(normalizeZoom(null), 1);
});

test('formatPaperTimestamp formats today as HH:MM today and older dates as MM/DD', () => {
  const now = new Date(2026, 10, 25, 14, 30, 0); // Nov 25, 2026 14:30 local
  const earlierToday = new Date(2026, 10, 25, 9, 5, 0).toISOString();
  const yesterday = new Date(2026, 10, 24, 22, 15, 0).toISOString();
  const earlierMonth = new Date(2026, 2, 8, 12, 0, 0).toISOString();

  assert.equal(formatPaperTimestamp(earlierToday, now), '09:05 today');
  assert.equal(formatPaperTimestamp(yesterday, now), '11/24');
  assert.equal(formatPaperTimestamp(earlierMonth, now), '03/08');
  assert.equal(formatPaperTimestamp(null, now), '');
  assert.equal(formatPaperTimestamp('not-a-date', now), '');
});

test('categorizePapers splits Unread and Read and sorts by created_at or last_opened_at', () => {
  const list = [
    { id: 'u1', title: 'Older unread', created_at: '2026-11-20T10:00:00.000Z' },
    { id: 'u2', title: 'Newer unread', created_at: '2026-11-25T10:00:00.000Z' },
    { id: 'r1', title: 'Older read', created_at: '2026-11-24T10:00:00.000Z' },
    { id: 'r2', title: 'Recent read', created_at: '2026-11-18T10:00:00.000Z' }
  ];
  const positions = {
    r1: { page: 2, offset: 0.1, last_opened_at: '2026-11-24T12:00:00.000Z' },
    r2: { page: 5, offset: 0.5, last_opened_at: '2026-11-25T14:00:00.000Z' }
  };

  const { unread, read } = categorizePapers(list, positions);
  assert.deepEqual(unread.map(x => [x.paper.id, x.timestamp]), [
    ['u2', '2026-11-25T10:00:00.000Z'],
    ['u1', '2026-11-20T10:00:00.000Z']
  ]);
  assert.deepEqual(read.map(x => [x.paper.id, x.timestamp]), [
    ['r2', '2026-11-25T14:00:00.000Z'],
    ['r1', '2026-11-24T12:00:00.000Z']
  ]);
});
