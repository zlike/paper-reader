import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.jsx';

function createPdfjsLoader() {
  const getDocument = vi.fn().mockImplementation(() => {
    const doc = {
      numPages: 2,
      destroy: vi.fn().mockResolvedValue(undefined),
      getPage: vi.fn().mockResolvedValue({
        view: [0, 0, 600, 800],
        getViewport: ({ scale }) => ({
          width: 600 * scale,
          height: 800 * scale,
          clone: () => ({ width: 600 * scale, height: 800 * scale }),
          convertToViewportPoint: (x, y) => [x * scale, (800 - y) * scale]
        }),
        render: () => ({ promise: Promise.resolve() }),
        streamTextContent: () => ({}),
        getAnnotations: async () => []
      })
    };
    return { promise: Promise.resolve(doc) };
  });

  class TextLayer {
    constructor({ container }) {
      this.container = container;
    }
    async render() {
      const span = document.createElement('span');
      span.textContent = 'Cited Reference Text';
      this.container.append(span);
    }
  }

  class AnnotationLayer {
    async render() {}
  }

  return {
    getDocument,
    loader: vi.fn().mockResolvedValue({ getDocument, TextLayer, AnnotationLayer })
  };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
    cb(0);
    return 1;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App integration', () => {
  const papers = [
    { id: 'p1', title: 'First Paper', created_at: '2026-11-20T10:00:00.000Z' },
    { id: 'p2', title: 'Second Paper', created_at: '2026-11-21T10:00:00.000Z' }
  ];

  it('opens library when empty and handles + Add PDF dialog', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ papers: [], readingState: { lastPaperId: null, positions: {} } })
    }));
    const { loader } = createPdfjsLoader();

    render(<App pdfjsLoader={loader} />);

    expect(await screen.findByText('No papers yet.')).toBeInTheDocument();
    expect(document.getElementById('library')).toHaveClass('open');

    await user.click(screen.getByRole('button', { name: '+ Add PDF' }));
    expect(document.getElementById('library')).not.toHaveClass('open');
    expect(screen.getByText('Find a paper')).toBeInTheDocument();
  });

  it('auto-reopens last paper, avoids re-loading already-open paper, zooms, switches papers, and handles popstate/visibility', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
      if (url === '/api/papers') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            papers,
            readingState: {
              lastPaperId: 'p1',
              positions: {
                p1: { page: 1, offset: 0.25, zoom: 1.25, last_opened_at: '2026-11-25T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z' }
              }
            }
          })
        };
      }
      if (url.includes('/progress')) {
        return { ok: true, status: 200, json: async () => ({ progress: JSON.parse(opts.body) }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loader, getDocument } = createPdfjsLoader();
    render(<App pdfjsLoader={loader} />);

    await waitFor(() => {
      expect(document.title).toBe('First Paper · Paper Reader');
    });
    expect(window.location.pathname).toBe('/papers/p1');
    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(getDocument).toHaveBeenCalledTimes(1);

    // Wait for pages to lay out
    await screen.findByLabelText('Page 1');

    // Open library, close via backdrop, then re-open and click already-open paper -> no reload
    await user.click(screen.getByRole('button', { name: 'Show library' }));
    expect(document.getElementById('library')).toHaveClass('open');
    fireEvent.click(document.getElementById('library-backdrop'));
    expect(document.getElementById('library')).not.toHaveClass('open');

    await user.click(screen.getByRole('button', { name: 'Show library' }));
    await user.click(screen.getByTitle('First Paper'));
    expect(document.getElementById('library')).not.toHaveClass('open');
    expect(getDocument).toHaveBeenCalledTimes(1);

    // Zoom in & zoom out (including clamping at 100%)
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('150%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('100%')).toBeInTheDocument();

    // Scroll reader & flush on visibilitychange / pagehide
    fireEvent.scroll(document.getElementById('reader'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    // Switch to second paper
    await user.click(screen.getByRole('button', { name: 'Show library' }));
    await user.click(screen.getByTitle('Second Paper'));
    await waitFor(() => {
      expect(document.title).toBe('Second Paper · Paper Reader');
    });
    expect(window.location.pathname).toBe('/papers/p2');
    expect(getDocument).toHaveBeenCalledTimes(2);

    // Popstate back to p1
    window.history.replaceState({}, '', '/papers/p1');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() => {
      expect(document.title).toBe('First Paper · Paper Reader');
    });

    // Popstate to root '/' closes paper without error message
    window.history.replaceState({}, '', '/');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() => {
      expect(document.title).toBe('Paper Reader');
    });

    // Re-open p1, then popstate to deleted paper -> closes paper and shows status
    await user.click(screen.getByRole('button', { name: 'Show library' }));
    await user.click(screen.getByTitle('First Paper'));
    await waitFor(() => {
      expect(document.title).toBe('First Paper · Paper Reader');
    });
    window.history.replaceState({}, '', '/papers/missing-id');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() => {
      expect(document.title).toBe('Paper Reader');
    });
    expect(window.location.pathname).toBe('/');
    expect(screen.getByText('The requested paper is no longer in your library.')).toBeInTheDocument();

    // Visibility change back to visible is a no-op
    fireEvent(document, new Event('visibilitychange'));

    // Re-clicking already-open paper when pathname differs restores /papers/:id
    await user.click(screen.getByRole('button', { name: 'Show library' }));
    await user.click(screen.getByTitle('Second Paper'));
    await waitFor(() => {
      expect(document.title).toBe('Second Paper · Paper Reader');
    });
    window.history.replaceState({}, '', '/');
    await user.click(screen.getByRole('button', { name: 'Show library' }));
    await user.click(screen.getByTitle('Second Paper'));
    expect(window.location.pathname).toBe('/papers/p2');
  });

  it('shows library status error when initial paper load fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Database unavailable' })
    }));

    render(<App pdfjsLoader={vi.fn()} />);
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
  });

  it('cleans up safely if unmounted while initial library request is pending', async () => {
    let resolvePapers;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(resolve => {
      resolvePapers = resolve;
    })));
    const { loader } = createPdfjsLoader();
    const { unmount } = render(<App pdfjsLoader={loader} />);
    unmount();
    await act(async () => {
      resolvePapers({
        ok: true,
        status: 200,
        json: async () => ({ papers, readingState: { lastPaperId: 'p1', positions: {} } })
      });
    });
    expect(document.title).toBe('Paper Reader');
  });

  it('handles deep-link to existing paper, deep-link to missing paper, and boot error', async () => {
    // 1. Deep-link to existing paper
    window.history.replaceState({}, '', '/papers/p2');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ papers, readingState: { lastPaperId: null, positions: {} } })
    }));
    const { loader } = createPdfjsLoader();
    const { unmount } = render(<App pdfjsLoader={loader} />);
    await waitFor(() => {
      expect(document.title).toBe('Second Paper · Paper Reader');
    });
    unmount();

    // 2. Deep-link to missing paper
    window.history.replaceState({}, '', '/papers/gone');
    const { unmount: unmount2 } = render(<App pdfjsLoader={loader} />);
    expect(await screen.findByText('The requested paper is no longer in your library.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(document.getElementById('library')).toHaveClass('open');
    unmount2();

    // 3. Boot error
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Database unavailable' })
    }));
    render(<App pdfjsLoader={loader} />);
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
  });

  it('shows Find cited paper button on PDF text selection and opens citation dialog', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/papers/p1');
    const fetchMock = vi.fn().mockImplementation(async url => {
      if (url === '/api/citations/search') {
        return { ok: true, status: 200, json: async () => ({ confident: null, candidates: [] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ papers, readingState: { lastPaperId: 'p1', positions: {} } })
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loader } = createPdfjsLoader();
    render(<App pdfjsLoader={loader} />);

    const page1 = await screen.findByLabelText('Page 1');
    await waitFor(() => {
      expect(page1.querySelector('.textLayer')).toBeTruthy();
    });

    const textNode = page1.querySelector('.textLayer').firstChild;
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Selected Citation',
      anchorNode: textNode
    });
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    const findBtn = screen.getByRole('button', { name: 'Find cited paper' });
    expect(findBtn).not.toHaveAttribute('hidden');

    await user.click(findBtn);
    expect(screen.getByText('Find a cited paper')).toBeInTheDocument();
    expect(screen.getByLabelText('Citation text')).toHaveValue('Selected Citation');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/citations/search',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'Selected Citation' })
        })
      );
    });

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.getElementById('citation-dialog')).not.toHaveAttribute('open');
  });

  it('sanitizes line-wrapped reading-pane selection, preserves compound hyphens, auto-triggers search, and ignores empty sanitized selection', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/papers/p1');
    const fetchMock = vi.fn().mockImplementation(async url => {
      if (url === '/api/citations/search') {
        return { ok: true, status: 200, json: async () => ({ confident: null, candidates: [] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ papers, readingState: { lastPaperId: 'p1', positions: {} } })
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loader } = createPdfjsLoader();
    render(<App pdfjsLoader={loader} />);

    const page1 = await screen.findByLabelText('Page 1');
    await waitFor(() => {
      expect(page1.querySelector('.textLayer')).toBeTruthy();
    });

    const textNode = page1.querySelector('.textLayer').firstChild;
    const selectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Self-\nfeedback in au-\ntonomous agents',
      anchorNode: textNode
    });
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    const findBtn = screen.getByRole('button', { name: 'Find cited paper' });
    expect(findBtn).not.toHaveAttribute('hidden');
    await user.click(findBtn);

    expect(screen.getByLabelText('Citation text')).toHaveValue('Self-feedback in autonomous agents');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/citations/search',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'Self-feedback in autonomous agents' })
        })
      );
    });

    await user.click(screen.getByRole('button', { name: 'Close' }));
    const searchCallsBefore = fetchMock.mock.calls.filter(([url]) => url === '/api/citations/search').length;

    // Selection that sanitizes to empty string keeps the button hidden and never triggers a spurious search
    selectionSpy.mockReturnValue({
      toString: () => '\u00AD\u2014   ',
      anchorNode: textNode
    });
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(findBtn).toHaveAttribute('hidden');
    fireEvent.click(findBtn);
    expect(document.getElementById('citation-dialog')).not.toHaveAttribute('open');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/citations/search')).toHaveLength(searchCallsBefore);
  });

  it('downloads a paper from CitationDialog and opens it in the reader', async () => {
    const user = userEvent.setup();
    let paperList = [...papers];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async url => {
      if (url === '/api/papers') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ papers: paperList, readingState: { lastPaperId: null, positions: {} } })
        };
      }
      if (url === '/api/citations/search') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            confident: null,
            candidates: [{ source: 'OPENALEX', id: 'W3', title: 'Third Paper', hasPdf: true }]
          })
        };
      }
      if (url === '/api/citations/download') {
        paperList = [...paperList, { id: 'p3', title: 'Third Paper', created_at: '2026-11-25T12:00:00.000Z' }];
        return { ok: true, status: 201, json: async () => ({ paper: { id: 'p3', title: 'Third Paper' }, existing: false }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const { loader } = createPdfjsLoader();
    render(<App pdfjsLoader={loader} />);

    await screen.findByTitle('First Paper');
    await user.click(screen.getByRole('button', { name: '+ Add PDF' }));
    await user.type(screen.getByLabelText('Paper title or DOI'), 'Third Paper');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'Download PDF' }));
    await user.click(await screen.findByRole('button', { name: 'Open paper' }));

    await waitFor(() => {
      expect(document.title).toBe('Third Paper · Paper Reader');
    });
    expect(window.location.pathname).toBe('/papers/p3');
  });

  it('opens LinkPreviewDialog on internal link click and hands off Find cited paper to CitationDialog without moving reader', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/papers/p1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ papers, readingState: { lastPaperId: 'p1', positions: {} } })
    }));

    const doc = {
      numPages: 3,
      destroy: vi.fn().mockResolvedValue(undefined),
      getDestination: async name => (name === 'ref-1' ? [2, { name: 'Fit' }] : null),
      getPageIndex: async () => 2,
      getPage: vi.fn().mockImplementation(async pageNumber => ({
        view: [0, 0, 600, 800],
        getViewport: ({ scale }) => ({
          width: 600 * scale,
          height: 800 * scale,
          clone: () => ({ width: 600 * scale, height: 800 * scale }),
          convertToViewportPoint: (x, y) => [x * scale, (800 - y) * scale]
        }),
        render: () => ({ promise: Promise.resolve() }),
        streamTextContent: () => ({}),
        getAnnotations: async () => (pageNumber === 1 ? [{ subtype: 'Link', dest: 'ref-1' }] : [])
      }))
    };

    class TextLayer {
      constructor({ container }) {
        this.container = container;
      }
      async render() {
        const span = document.createElement('span');
        span.textContent = '[1] Cited Reference From Preview';
        this.container.append(span);
      }
    }

    class AnnotationLayer {
      constructor({ div }) {
        this.div = div;
      }
      async render({ annotations, linkService }) {
        for (const ann of annotations) {
          const section = document.createElement('section');
          section.className = 'linkAnnotation';
          const a = document.createElement('a');
          a.href = '#';
          a.addEventListener('click', e => {
            e.preventDefault();
            linkService.goToDestination(ann.dest);
          });
          section.append(a);
          this.div.append(section);
        }
      }
    }

    const loader = vi.fn().mockResolvedValue({
      getDocument: () => ({ promise: Promise.resolve(doc) }),
      TextLayer,
      AnnotationLayer
    });

    render(<App pdfjsLoader={loader} />);

    const page1 = await screen.findByLabelText('Page 1');
    await waitFor(() => {
      expect(page1.querySelector('.linkAnnotation > a')).toBeTruthy();
    });

    const readerEl = document.getElementById('reader');
    readerEl.scrollTop = 240;

    // Tap internal link -> opens LinkPreviewDialog on Page 3 without changing reader scrollTop
    fireEvent.click(page1.querySelector('.linkAnnotation > a'));
    expect(await screen.findByText('Page 3')).toBeInTheDocument();
    expect(readerEl.scrollTop).toBe(240);

    // Wait for preview page textLayer to render
    const previewPages = document.getElementById('link-preview-pages');
    await waitFor(() => {
      expect(previewPages.querySelector('.textLayer span')).toBeTruthy();
    });

    const previewTextNode = previewPages.querySelector('.textLayer span').firstChild;
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '[1] Cited Reference From Preview',
      anchorNode: previewTextNode,
      isCollapsed: false
    });
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    // Click Find cited paper inside LinkPreviewDialog -> opens CitationDialog pre-filled
    const previewFindBtn = document.getElementById('link-preview-find-selection');
    expect(previewFindBtn).not.toHaveAttribute('hidden');
    await user.click(previewFindBtn);

    expect(screen.getByText('Find a cited paper')).toBeInTheDocument();
    expect(screen.getByLabelText('Citation text')).toHaveValue('[1] Cited Reference From Preview');
    expect(readerEl.scrollTop).toBe(240);

    // Closing CitationDialog preserves reader scrollTop
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.getElementById('citation-dialog')).not.toHaveAttribute('open');
    expect(readerEl.scrollTop).toBe(240);
  });
});
