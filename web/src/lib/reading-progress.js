export const STORAGE_KEY = 'paper-reader:reading-state:v1';

export function paperIdFromPath(pathname) {
  if (typeof pathname !== 'string') return null;
  const match = pathname.match(/^\/papers\/([^/?#]+)\/?$/);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]);
    return decoded || null;
  } catch {
    return null;
  }
}

export function paperPath(id) {
  return id ? `/papers/${encodeURIComponent(id)}` : '/';
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 2.5;
export const ZOOM_STEP = 0.05;

export function normalizeZoom(zoom) {
  if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return MIN_ZOOM;
  const steps = Math.round(zoom / ZOOM_STEP);
  const rounded = Math.round(steps * ZOOM_STEP * 100) / 100;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rounded));
}

export function computeReadingPosition(pages, scrollTop) {
  if (!Array.isArray(pages) || !pages.length) return null;
  const y = typeof scrollTop === 'number' && Number.isFinite(scrollTop) ? scrollTop : 0;
  for (const current of pages) {
    const bottom = current.top + current.height;
    if (y < bottom) {
      const raw = current.height > 0 ? (y - current.top) / current.height : 0;
      const offset = Math.max(0, Math.min(1, Math.round(raw * 10000) / 10000));
      return { page: current.page, offset };
    }
  }
  const last = pages[pages.length - 1];
  return { page: last.page, offset: 1 };
}

export function computeScrollTop(pages, position) {
  if (!Array.isArray(pages) || !pages.length || !position) return 0;
  const requestedPage = Number.isInteger(position.page) ? position.page : 1;
  const target = pages.find(p => p.page === requestedPage)
    || pages[Math.max(0, Math.min(pages.length - 1, requestedPage - 1))];
  const offset = typeof position.offset === 'number' && Number.isFinite(position.offset)
    ? Math.max(0, Math.min(1, position.offset))
    : 0;
  if (target === pages[0] && offset === 0) return 0;
  return Math.max(0, Math.round(target.top + offset * target.height));
}

function timestampValue(value) {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergeReadingStates(serverState, localState, validPaperIds = null) {
  const serverPositions = serverState?.positions && typeof serverState.positions === 'object' ? serverState.positions : {};
  const localPositions = localState?.positions && typeof localState.positions === 'object' ? localState.positions : {};
  const allIds = new Set([...Object.keys(serverPositions), ...Object.keys(localPositions)]);
  const positions = {};

  for (const id of allIds) {
    if (validPaperIds && !validPaperIds.has(id)) continue;
    const s = serverPositions[id];
    const l = localPositions[id];
    if (s && l) {
      const sTime = timestampValue(s.updated_at || s.last_opened_at);
      const lTime = timestampValue(l.updated_at || l.last_opened_at);
      positions[id] = lTime > sTime ? { ...l } : { ...s };
    } else if (s) {
      positions[id] = { ...s };
    } else if (l) {
      positions[id] = { ...l };
    }
  }

  let lastPaperId = null;
  let latestOpened = -1;
  for (const [id, entry] of Object.entries(positions)) {
    const opened = timestampValue(entry.last_opened_at || entry.updated_at);
    if (opened > latestOpened) {
      latestOpened = opened;
      lastPaperId = id;
    }
  }

  if (!lastPaperId) {
    for (const candidate of [serverState?.lastPaperId, localState?.lastPaperId]) {
      if (candidate && (!validPaperIds || validPaperIds.has(candidate))) {
        lastPaperId = candidate;
        break;
      }
    }
  }

  return { lastPaperId, positions };
}

export function loadLocalReadingState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { lastPaperId: null, positions: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { lastPaperId: null, positions: {} };
    return {
      lastPaperId: typeof parsed.lastPaperId === 'string' ? parsed.lastPaperId : null,
      positions: parsed.positions && typeof parsed.positions === 'object' ? parsed.positions : {}
    };
  } catch {
    return { lastPaperId: null, positions: {} };
  }
}

export function saveLocalReadingState(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({
      lastPaperId: state?.lastPaperId ?? null,
      positions: state?.positions ?? {}
    }));
  } catch {
    // Ignore storage quota or private-mode errors.
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatPaperTimestamp(isoString, now = new Date()) {
  if (typeof isoString !== 'string' || !isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (isToday) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())} today`;
  }
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
}

export function categorizePapers(papers, positions = {}) {
  const unread = [];
  const read = [];
  for (const paper of papers || []) {
    const lastOpenedAt = positions?.[paper.id]?.last_opened_at || null;
    if (lastOpenedAt) {
      read.push({ paper, timestamp: lastOpenedAt });
    } else {
      unread.push({ paper, timestamp: paper.created_at || null });
    }
  }
  unread.sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp));
  read.sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp));
  return { unread, read };
}
