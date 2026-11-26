import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  downloadCitation,
  fetchPapers,
  savePaperProgress,
  searchCitations
} from '../src/lib/api.js';
import { loadPdfjs, resetPdfjsCache } from '../src/lib/pdfjs.js';
import {
  computePreviewTarget,
  destinationPosition,
  findLinkAtPoint,
  isSafeExternalUrl,
  isSupportedLink,
  resolveDestination
} from '../src/lib/pdf-links.js';
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
} from '../src/lib/reading-progress.js';

afterEach(() => {
  vi.restoreAllMocks();
  resetPdfjsCache();
});

describe('api helpers', () => {
  it('fetches JSON and throws server or fallback error messages', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ papers: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'Bad input' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }));

    await expect(fetchPapers()).resolves.toEqual({ papers: [] });
    await expect(apiFetch('/api/bad')).rejects.toThrow('Bad input');
    await expect(apiFetch('/api/fail')).rejects.toThrow('Request failed (500)');
  });

  it('sends POST requests for citation search and download', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true })
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchCitations('10.1234/test');
    expect(fetchMock).toHaveBeenCalledWith('/api/citations/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '10.1234/test' })
    });

    await downloadCitation('OPENALEX', 'W42');
    expect(fetchMock).toHaveBeenCalledWith('/api/citations/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'OPENALEX', id: 'W42' })
    });
  });

  it('saves reading progress via PUT fetch or keepalive sendBeacon with fallback', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    savePaperProgress('p/1', { page: 2, offset: 0.5, zoom: 1, opened: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/papers/p%2F1/progress', expect.objectContaining({
      method: 'PUT',
      keepalive: false
    }));

    const beaconMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beaconMock, configurable: true });
    savePaperProgress('p1', { page: 3, offset: 0.1, zoom: 1.25, opened: true }, { keepalive: true });
    expect(beaconMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // sendBeacon throws -> falls back to keepalive fetch
    beaconMock.mockImplementationOnce(() => { throw new Error('blocked'); });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    savePaperProgress('p1', { page: 4, offset: 0.2, zoom: 1, opened: true }, { keepalive: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/papers/p1/progress', expect.objectContaining({
      keepalive: true
    }));
  });
});

describe('pdfjs loader', () => {
  it('loads once, configures workerSrc, and caches the module', async () => {
    const fakeMod = { GlobalWorkerOptions: { workerSrc: '' }, getDocument: vi.fn() };
    const importer = vi.fn().mockResolvedValue(fakeMod);

    const first = await loadPdfjs(importer);
    const second = await loadPdfjs(importer);

    expect(first).toBe(fakeMod);
    expect(second).toBe(fakeMod);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(fakeMod.GlobalWorkerOptions.workerSrc).toBe('/vendor/pdfjs/build/pdf.worker.mjs');
  });
});

describe('pdf-links', () => {
  it('validates safe URLs and supported link annotations', () => {
    expect(isSafeExternalUrl('https://example.org')).toBe(true);
    expect(isSafeExternalUrl('http://example.org')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@example.org')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('not-a-url')).toBe(false);

    expect(isSupportedLink({ subtype: 'Text', url: 'https://example.org' })).toBe(false);
    expect(isSupportedLink({ subtype: 'Link', url: 'https://example.org' })).toBe(true);
    expect(isSupportedLink({ subtype: 'Link', unsafeUrl: 'javascript:alert(1)' })).toBe(false);
    expect(isSupportedLink({ subtype: 'Link', dest: 'sec-1' })).toBe(true);
    expect(isSupportedLink({ subtype: 'Link', action: 'FirstPage' })).toBe(true);
    expect(isSupportedLink({ subtype: 'Link', action: 'Launch' })).toBe(false);
  });

  it('resolves named and explicit destinations and rejects invalid ones', async () => {
    const ref = { num: 7, gen: 0 };
    const doc = {
      numPages: 3,
      getDestination: async name => (name === 'refs' ? [ref, { name: 'Fit' }] : null),
      getPageIndex: async r => (r === ref ? 2 : -1)
    };

    await expect(resolveDestination(doc, 'refs')).resolves.toEqual({
      pageNumber: 3,
      destination: [ref, { name: 'Fit' }]
    });
    await expect(resolveDestination(doc, [0, { name: 'Fit' }])).resolves.toEqual({
      pageNumber: 1,
      destination: [0, { name: 'Fit' }]
    });
    await expect(resolveDestination(doc, 'unknown')).rejects.toThrow('not found');
    await expect(resolveDestination(doc, [9, { name: 'Fit' }])).rejects.toThrow('invalid page');
  });

  it('computes destination coordinates for all PDF destination kinds', () => {
    const page = { view: [10, 0, 610, 800] };
    const viewport = {
      convertToViewportPoint: (x, y) => [x * 2, (800 - y) * 2],
      convertToViewportRectangle: ([x1, y1, x2, y2]) => [x1, 800 - y1, x2, 800 - y2]
    };

    expect(destinationPosition(page, viewport, [0, { name: 'Fit' }])).toEqual({ x: 0, y: 0 });
    expect(destinationPosition(page, viewport, [0, { name: 'FitB' }])).toEqual({ x: 0, y: 0 });
    expect(destinationPosition(page, viewport, [0, { name: 'XYZ' }, 50, 600, null])).toEqual({ x: 100, y: 400 });
    expect(destinationPosition(page, viewport, [0, { name: 'XYZ' }, null, null, null])).toEqual({ x: 20, y: 0 });
    expect(destinationPosition(page, viewport, [0, { name: 'FitH' }, 500])).toEqual({ x: 20, y: 600 });
    expect(destinationPosition(page, viewport, [0, { name: 'FitBH' }])).toEqual({ x: 20, y: 0 });
    expect(destinationPosition(page, viewport, [0, { name: 'FitV' }, 40])).toEqual({ x: 80, y: 0 });
    expect(destinationPosition(page, viewport, [0, { name: 'FitBV' }])).toEqual({ x: 20, y: 0 });
    expect(destinationPosition(page, viewport, [0, { name: 'FitR' }, 10, 200, 100, 600])).toEqual({ x: 10, y: 200 });

    expect(() => destinationPosition(page, viewport, [0, { name: 'FitR' }, 1, 2])).toThrow('Invalid');
    expect(() => destinationPosition(page, viewport, [0, { name: 'Unknown' }])).toThrow('Unsupported');
    expect(() => destinationPosition(page, viewport, [0, { name: 'XYZ' }, Number.NaN, 100])).toThrow('Invalid');
  });

  it('computes preview scroll targets and adjacent next-page inclusion', () => {
    const page = { view: [0, 0, 600, 800] };
    const viewport = {
      width: 600,
      height: 800,
      convertToViewportPoint: (x, y) => [x, 800 - y]
    };

    // Near top of page -> no adjacent next page
    expect(computePreviewTarget(page, viewport, [0, { name: 'Fit' }], 1, 3)).toEqual({
      x: 0,
      y: 0,
      scrollTop: 0,
      scrollLeft: 0,
      includeNextPage: false
    });

    // Near bottom of page (y=160 -> viewport y=640, 80% >= 60%) on non-last page -> includes next page
    expect(computePreviewTarget(page, viewport, [1, { name: 'XYZ' }, 72, 160, null], 2, 4)).toEqual({
      x: 72,
      y: 640,
      scrollTop: 616,
      scrollLeft: 56,
      includeNextPage: true
    });

    // Near bottom on last page -> does not include next page
    expect(computePreviewTarget(page, viewport, [3, { name: 'XYZ' }, 72, 160, null], 4, 4)).toEqual({
      x: 72,
      y: 640,
      scrollTop: 616,
      scrollLeft: 56,
      includeNextPage: false
    });

    // Out-of-bounds coordinates clamp cleanly to viewport bounds
    expect(computePreviewTarget(page, viewport, [0, { name: 'XYZ' }, -50, -200, null], 1, 2)).toEqual({
      x: 0,
      y: 800,
      scrollTop: 776,
      scrollLeft: 0,
      includeNextPage: true
    });
  });

  it('hit-tests .linkAnnotation > a bounding rects within a page', () => {
    expect(findLinkAtPoint(null, 10, 10)).toBeNull();

    const page = document.createElement('div');
    page.className = 'page';
    const emptySection = document.createElement('section');
    emptySection.className = 'linkAnnotation';
    const zeroLink = document.createElement('a');
    vi.spyOn(zeroLink, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    emptySection.append(zeroLink);

    const activeSection = document.createElement('section');
    activeSection.className = 'linkAnnotation';
    const activeLink = document.createElement('a');
    vi.spyOn(activeLink, 'getBoundingClientRect').mockReturnValue({ left: 20, right: 80, top: 30, bottom: 50 });
    activeSection.append(activeLink);

    page.append(emptySection, activeSection);

    expect(findLinkAtPoint(page, 0, 0)).toBeNull();
    expect(findLinkAtPoint(page, 50, 40)).toBe(activeLink);
    expect(findLinkAtPoint(page, 19, 40)).toBeNull();
    expect(findLinkAtPoint(page, 50, 51)).toBeNull();
  });
});

describe('reading-progress helpers', () => {
  it('handles paths, zoom normalization, position calculation, and scroll restoration', () => {
    expect(paperPath('a b')).toBe('/papers/a%20b');
    expect(paperPath(null)).toBe('/');
    expect(paperIdFromPath('/papers/a%20b/')).toBe('a b');
    expect(paperIdFromPath('/papers/%E0%A4%A')).toBeNull();
    expect(paperIdFromPath(null)).toBeNull();
    expect(paperIdFromPath('/')).toBeNull();

    expect(normalizeZoom(1.37)).toBe(1.25);
    expect(normalizeZoom(0.1)).toBe(1);
    expect(normalizeZoom(5)).toBe(2.5);
    expect(normalizeZoom(Number.NaN)).toBe(1);

    expect(computeReadingPosition([], 100)).toBeNull();
    expect(computeReadingPosition([{ page: 1, top: 10, height: 0 }], Number.NaN)).toEqual({ page: 1, offset: 0 });
    const pages = [
      { page: 1, top: 10, height: 100 },
      { page: 2, top: 120, height: 100 }
    ];
    expect(computeReadingPosition(pages, 60)).toEqual({ page: 1, offset: 0.5 });
    expect(computeReadingPosition(pages, 500)).toEqual({ page: 2, offset: 1 });

    expect(computeScrollTop([], { page: 1, offset: 0 })).toBe(0);
    expect(computeScrollTop(pages, null)).toBe(0);
    expect(computeScrollTop(pages, { page: 1, offset: 0 })).toBe(0);
    expect(computeScrollTop(pages, { page: 2, offset: 0.5 })).toBe(170);
    expect(computeScrollTop(pages, { page: 'bad', offset: Number.NaN })).toBe(0);
  });

  it('merges reading states, handles storage errors, formats timestamps, and categorizes papers', () => {
    const merged = mergeReadingStates(
      {
        lastPaperId: 'p1',
        positions: {
          p1: { page: 2, offset: 0.1, updated_at: '2026-11-25T10:00:00Z' },
          p3: { page: 5, offset: 0.2, updated_at: '2026-11-25T12:00:00Z' },
          p4: { page: 1, offset: 0.0, updated_at: '2026-11-25T08:00:00Z' },
          gone: { page: 1, offset: 0.0, updated_at: '2026-11-25T15:00:00Z' }
        }
      },
      {
        lastPaperId: 'p2',
        positions: {
          p2: { page: 1, offset: 0.5, updated_at: '2026-11-25T11:00:00Z' },
          p3: { page: 1, offset: 0.0, updated_at: '2026-11-25T09:00:00Z' },
          p4: { page: 7, offset: 0.9, updated_at: '2026-11-25T13:00:00Z' }
        }
      },
      new Set(['p1', 'p2', 'p3', 'p4'])
    );
    expect(merged.lastPaperId).toBe('p4');
    expect(merged.positions.p3.page).toBe(5);
    expect(merged.positions.p4.page).toBe(7);
    expect(merged.positions.gone).toBeUndefined();

    // Fallback lastPaperId when no positions exist
    const fallback = mergeReadingStates({ lastPaperId: 'p1', positions: {} }, { lastPaperId: 'p2', positions: {} }, new Set(['p1']));
    expect(fallback.lastPaperId).toBe('p1');
    const localFallback = mergeReadingStates({ lastPaperId: null, positions: {} }, { lastPaperId: 'p2', positions: {} }, new Set(['p2']));
    expect(localFallback.lastPaperId).toBe('p2');
    expect(mergeReadingStates(null, null)).toEqual({ lastPaperId: null, positions: {} });
    expect(categorizePapers(null)).toEqual({ unread: [], read: [] });

    // Storage load/save edge cases
    const throwingStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); }
    };
    expect(loadLocalReadingState(throwingStorage)).toEqual({ lastPaperId: null, positions: {} });
    expect(() => saveLocalReadingState({ lastPaperId: 'p1', positions: {} }, throwingStorage)).not.toThrow();

    const store = new Map([[STORAGE_KEY, '123']]);
    expect(loadLocalReadingState({ getItem: k => store.get(k) })).toEqual({ lastPaperId: null, positions: {} });
    store.set(STORAGE_KEY, '{"lastPaperId":123,"positions":"bad"}');
    expect(loadLocalReadingState({ getItem: k => store.get(k) })).toEqual({ lastPaperId: null, positions: {} });

    const now = new Date(2026, 10, 25, 14, 0, 0);
    expect(formatPaperTimestamp(new Date(2026, 10, 25, 8, 5, 0).toISOString(), now)).toBe('08:05 today');
    expect(formatPaperTimestamp(new Date(2026, 10, 20, 8, 5, 0).toISOString(), now)).toBe('11/20');
    expect(formatPaperTimestamp('', now)).toBe('');
    expect(formatPaperTimestamp('invalid', now)).toBe('');

    const { unread, read } = categorizePapers(
      [
        { id: 'u1', title: 'Unread', created_at: '2026-11-20T10:00:00Z' },
        { id: 'r1', title: 'Read', created_at: '2026-11-19T10:00:00Z' }
      ],
      { r1: { last_opened_at: '2026-11-25T12:00:00Z' } }
    );
    expect(unread.map(x => x.paper.id)).toEqual(['u1']);
    expect(read.map(x => x.paper.id)).toEqual(['r1']);
    expect(categorizePapers(null)).toEqual({ unread: [], read: [] });
    expect(() => saveLocalReadingState(null, throwingStorage)).not.toThrow();
  });
});
