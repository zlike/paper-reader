import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Header } from '../src/components/Header.jsx';
import { LibraryDrawer } from '../src/components/LibraryDrawer.jsx';
import { CitationDialog } from '../src/components/CitationDialog.jsx';
import { PdfReader } from '../src/components/PdfReader.jsx';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Header', () => {
  it('renders title, library toggle state, and zoom controls', async () => {
    const user = userEvent.setup();
    const onToggleLibrary = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();

    const { rerender } = render(
      <Header
        libraryOpen={false}
        onToggleLibrary={onToggleLibrary}
        currentTitle={null}
        showZoom={false}
        zoom={1}
        onZoomOut={onZoomOut}
        onZoomIn={onZoomIn}
      />
    );

    const toggle = screen.getByRole('button', { name: 'Show library' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Your research library')).toBeInTheDocument();
    expect(document.getElementById('zoom-controls')).toHaveAttribute('hidden');

    await user.click(toggle);
    expect(onToggleLibrary).toHaveBeenCalledTimes(1);

    rerender(
      <Header
        libraryOpen
        onToggleLibrary={onToggleLibrary}
        currentTitle="Attention Is All You Need"
        showZoom
        zoom={1.5}
        onZoomOut={onZoomOut}
        onZoomIn={onZoomIn}
      />
    );

    expect(screen.getByRole('button', { name: 'Hide library' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Attention Is All You Need')).toBeInTheDocument();
    expect(screen.getByText('150%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });
});

describe('LibraryDrawer', () => {
  const samplePapers = [
    { id: 'u1', title: 'Unread Paper', created_at: '2026-11-20T10:00:00.000Z' },
    { id: 'r1', title: 'Read Paper', created_at: '2026-11-18T10:00:00.000Z' }
  ];
  const samplePositions = {
    r1: { page: 2, offset: 0.2, last_opened_at: '2026-11-25T10:00:00.000Z' }
  };

  it('renders empty state and populated Unread/Read sections', async () => {
    const user = userEvent.setup();
    const onSelectPaper = vi.fn();
    const onAddPaper = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <LibraryDrawer
        open
        dialogOpen={false}
        papers={[]}
        positions={{}}
        currentId={null}
        statusMessage=""
        onClose={onClose}
        onSelectPaper={onSelectPaper}
        onAddPaper={onAddPaper}
      />
    );

    expect(screen.getByText('No papers yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Add PDF' }));
    expect(onAddPaper).toHaveBeenCalledTimes(1);

    rerender(
      <LibraryDrawer
        open
        dialogOpen={false}
        papers={samplePapers}
        positions={samplePositions}
        currentId="r1"
        statusMessage="Library notice"
        onClose={onClose}
        onSelectPaper={onSelectPaper}
        onAddPaper={onAddPaper}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Library notice');
    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();

    const readBtn = screen.getByTitle('Read Paper');
    expect(readBtn).toHaveClass('active');
    await user.click(screen.getByTitle('Unread Paper'));
    expect(onSelectPaper).toHaveBeenCalledWith('u1');
  });

  it('shows empty section labels when one section is empty', () => {
    render(
      <LibraryDrawer
        open
        dialogOpen={false}
        papers={[samplePapers[0]]}
        positions={{}}
        currentId={null}
        statusMessage=""
        onClose={vi.fn()}
        onSelectPaper={vi.fn()}
        onAddPaper={vi.fn()}
      />
    );
    expect(screen.getByText('No read papers yet.')).toBeInTheDocument();
  });

  it('closes on backdrop click, Escape key (when dialog closed), and swipe-left gesture', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <LibraryDrawer
        open
        dialogOpen={false}
        papers={samplePapers}
        positions={samplePositions}
        currentId={null}
        statusMessage=""
        onClose={onClose}
        onSelectPaper={vi.fn()}
        onAddPaper={vi.fn()}
      />
    );

    fireEvent.click(document.getElementById('library-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Escape should not close drawer when dialog is open
    rerender(
      <LibraryDrawer
        open
        dialogOpen
        papers={samplePapers}
        positions={samplePositions}
        currentId={null}
        statusMessage=""
        onClose={onClose}
        onSelectPaper={vi.fn()}
        onAddPaper={vi.fn()}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Touch swipe-left closes drawer
    const aside = document.getElementById('library');
    fireEvent.touchStart(aside, { touches: [{ clientX: 250, clientY: 120 }] });
    fireEvent.touchMove(aside, { touches: [{ clientX: 150, clientY: 122 }] });
    expect(aside).toHaveClass('swiping');
    fireEvent.touchEnd(aside);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('CitationDialog', () => {
  it('handles ambiguous search, download failure/retry, and opening paper', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      // Search returns two candidates: one with PDF, one without
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          confident: null,
          candidates: [
            { source: 'OPENALEX', id: 'W1', title: 'Paper One', authors: 'A. Author', year: 2024, doi: '10.1/a', hasPdf: true },
            { source: 'OPENALEX', id: 'W2', title: 'Paper Two', authors: 'B. Author', year: 2023, hasPdf: false }
          ]
        })
      })
      // First download fails
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Upstream timeout' })
      })
      // Retry download succeeds (new paper)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ paper: { id: 'p-new' }, existing: false })
      });
    vi.stubGlobal('fetch', fetchMock);

    const onClose = vi.fn();
    const onPaperAdded = vi.fn().mockResolvedValue(undefined);
    const onOpenPaper = vi.fn();

    render(
      <CitationDialog
        open
        title="Find a paper"
        hint="Search by title or DOI"
        initialText="Paper One"
        label="Paper title or DOI"
        onClose={onClose}
        onPaperAdded={onPaperAdded}
        onOpenPaper={onOpenPaper}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Choose the correct paper from these possible matches.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No open-access PDF listed' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(await screen.findByText('Upstream timeout')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: 'Retry download' });

    await user.click(retryBtn);
    expect(await screen.findByText('PDF added to your library.')).toBeInTheDocument();
    expect(onPaperAdded).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Open paper' }));
    expect(onOpenPaper).toHaveBeenCalledWith('p-new');
    expect(onClose).toHaveBeenCalled();
  });

  it('auto-downloads confident DOI match (existing), handles confident without PDF, empty results, and errors', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      // 1. Confident match with PDF -> auto-downloads -> existing paper
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          confident: { source: 'OPENALEX', id: 'W10', title: 'Exact Paper', hasPdf: true },
          candidates: [{ source: 'OPENALEX', id: 'W10', title: 'Exact Paper', hasPdf: true }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ paper: { id: 'p-existing' }, existing: true })
      })
      // 2. Confident match without PDF
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          confident: { source: 'OPENALEX', id: 'W11', title: 'Paywalled Paper', hasPdf: false },
          candidates: [{ source: 'OPENALEX', id: 'W11', title: 'Paywalled Paper', hasPdf: false }]
        })
      })
      // 3. Empty candidates
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ confident: null, candidates: [] })
      })
      // 4. Search error
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Select citation text' })
      });
    vi.stubGlobal('fetch', fetchMock);

    const onClose = vi.fn();
    render(
      <CitationDialog
        open
        title="Find a cited paper"
        hint="Hint"
        initialText="10.1234/exact"
        label="Citation text"
        onClose={onClose}
        onPaperAdded={vi.fn().mockResolvedValue(undefined)}
        onOpenPaper={vi.fn()}
      />
    );

    // 1. Confident with PDF
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('This paper is already in your library.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open existing paper' })).toBeInTheDocument();

    // 2. Confident without PDF
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Exact match found, but no open-access PDF is listed.')).toBeInTheDocument();

    // 3. Empty results
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No matches found. Try the full title or DOI.')).toBeInTheDocument();

    // 4. Search error
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Select citation text')).toBeInTheDocument();

    // Typing updates textarea value
    const textarea = screen.getByLabelText('Citation text');
    await user.clear(textarea);
    await user.type(textarea, 'New query');
    expect(textarea).toHaveValue('New query');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores stale search and download responses after dialog closes', async () => {
    const user = userEvent.setup();
    let resolveSearch;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(resolve => {
      resolveSearch = resolve;
    })));

    const { rerender } = render(
      <CitationDialog
        open
        title="Find a paper"
        hint="Hint"
        initialText="Query"
        label="Paper title"
        onClose={vi.fn()}
        onPaperAdded={vi.fn()}
        onOpenPaper={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Search' }));
    rerender(
      <CitationDialog
        open={false}
        title="Find a paper"
        hint="Hint"
        initialText="Query"
        label="Paper title"
        onClose={vi.fn()}
        onPaperAdded={vi.fn()}
        onOpenPaper={vi.fn()}
      />
    );

    await act(async () => {
      resolveSearch({
        ok: true,
        status: 200,
        json: async () => ({ confident: null, candidates: [{ source: 'OPENALEX', id: 'W99', title: 'Stale', hasPdf: true }] })
      });
    });
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('ignores stale download resolution and error after dialog closes', async () => {
    const user = userEvent.setup();
    let resolveDownload;
    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            confident: null,
            candidates: [{ source: 'OPENALEX', id: 'W88', title: 'Slow Download', hasPdf: true }]
          })
        });
      }
      return new Promise(resolve => { resolveDownload = resolve; });
    }));

    const { rerender } = render(
      <CitationDialog
        open
        title="Find a paper"
        hint="Hint"
        initialText="Slow"
        label="Paper title"
        onClose={vi.fn()}
        onPaperAdded={vi.fn().mockResolvedValue(undefined)}
        onOpenPaper={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'Download PDF' }));

    rerender(
      <CitationDialog
        open={false}
        title="Find a paper"
        hint="Hint"
        initialText="Slow"
        label="Paper title"
        onClose={vi.fn()}
        onPaperAdded={vi.fn().mockResolvedValue(undefined)}
        onOpenPaper={vi.fn()}
      />
    );

    await act(async () => {
      resolveDownload({
        ok: true,
        status: 201,
        json: async () => ({ paper: { id: 'p88' }, existing: false })
      });
    });
    expect(screen.queryByText('PDF added to your library.')).not.toBeInTheDocument();
  });
});

describe('PdfReader and PdfPage', () => {
  function createMockPdfjs({ numPages = 2, annotationsByPage = {}, failOpen = false, failPage = null } = {}) {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn().mockImplementation(async pageNumber => {
      if (failPage === pageNumber) throw new Error('Corrupt page');
      return {
        view: [0, 0, 600, 800],
        getViewport: ({ scale }) => ({
          width: 600 * scale,
          height: 800 * scale,
          clone: () => ({ width: 600 * scale, height: 800 * scale }),
          convertToViewportPoint: (x, y) => [x * scale, (800 - y) * scale],
          convertToViewportRectangle: ([x1, y1, x2, y2]) => [x1, y1, x2, y2]
        }),
        render: () => ({ promise: Promise.resolve() }),
        streamTextContent: () => ({}),
        getAnnotations: async () => annotationsByPage[pageNumber] || []
      };
    });

    const doc = {
      numPages,
      getPage,
      destroy,
      getDestination: async name => {
        if (name === 'throw-dest') throw new Error('Link failed');
        return name === 'go-p2' ? [1, { name: 'Fit' }] : null;
      },
      getPageIndex: async () => 1
    };

    class TextLayer {
      constructor({ container }) {
        this.container = container;
      }
      async render() {
        const span = document.createElement('span');
        span.textContent = 'Sample PDF Text';
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
          if (ann.url) {
            linkService.addLinkAttributes(a, ann.url);
          } else if (ann.dest) {
            a.href = linkService.getDestinationHash();
            a.addEventListener('click', e => {
              e.preventDefault();
              linkService.goToDestination(ann.dest);
            });
          } else if (ann.action) {
            a.href = linkService.getAnchorUrl();
            a.addEventListener('click', e => {
              e.preventDefault();
              linkService.executeNamedAction(ann.action);
            });
          }
          section.append(a);
          this.div.append(section);
        }
      }
    }

    return {
      doc,
      loader: vi.fn().mockResolvedValue({
        getDocument: () => ({
          promise: failOpen ? Promise.reject(new Error('Invalid PDF')) : Promise.resolve(doc)
        }),
        TextLayer,
        AnnotationLayer
      })
    };
  }

  it('renders virtualized pages, handles links, named actions, hit-testing, and offscreen cleanup', async () => {
    let ioCallback = null;
    class MockIntersectionObserver {
      constructor(cb) {
        ioCallback = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});

    const { loader } = createMockPdfjs({
      numPages: 2,
      annotationsByPage: {
        1: [
          { subtype: 'Link', url: 'https://example.org' },
          { subtype: 'Link', dest: 'go-p2' },
          { subtype: 'Link', dest: 'broken-dest' },
          { subtype: 'Link', dest: 'throw-dest' },
          { subtype: 'Link', action: 'NextPage' },
          { subtype: 'Link', action: 'PrevPage' }
        ]
      }
    });

    const pagesRef = createRef();
    const apiRef = createRef();
    const onScroll = vi.fn();

    render(
      <PdfReader
        paperId="p1"
        zoom={1}
        initialPosition={{ page: 1, offset: 0 }}
        onScroll={onScroll}
        pagesContainerRef={pagesRef}
        readerApiRef={apiRef}
        pdfjsLoader={loader}
      />
    );

    const page1 = await screen.findByLabelText('Page 1');
    const page2 = screen.getByLabelText('Page 2');
    await waitFor(() => expect(ioCallback).toBeTypeOf('function'));

    // Mark page 1 visible via IntersectionObserver
    act(() => {
      ioCallback([{ target: page1, isIntersecting: true }]);
    });

    await waitFor(() => {
      expect(page1.dataset.rendered).toBe('true');
    });
    expect(page1.querySelector('canvas')).toBeTruthy();
    expect(page1.querySelector('.textLayer')).toHaveTextContent('Sample PDF Text');

    const links = page1.querySelectorAll('.linkAnnotation > a');
    expect(links).toHaveLength(6);
    expect(links[0]).toHaveAttribute('aria-label', 'Open external link in a new tab');
    expect(links[1]).toHaveAttribute('aria-label', 'Go to link in this paper');

    // Trigger valid internal link + named actions (NextPage valid, PrevPage out of bounds no-op)
    fireEvent.click(links[1]);
    fireEvent.click(links[4]);
    fireEvent.click(links[5]);

    // Trigger broken internal link and throwing destination -> shows reader-status error
    fireEvent.click(links[2]);
    fireEvent.click(links[3]);
    expect(await screen.findByText(/Unable to follow PDF link/)).toBeInTheDocument();

    // Hit-test click on page outside annotationLayer delegates to matching link
    const linkClickSpy = vi.spyOn(links[1], 'click');
    vi.spyOn(links[0], 'getBoundingClientRect').mockReturnValue({ left: 0, right: 10, top: 0, bottom: 10 });
    vi.spyOn(links[1], 'getBoundingClientRect').mockReturnValue({ left: 20, right: 60, top: 20, bottom: 60 });
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true });
    fireEvent.click(page1, { clientX: 30, clientY: 30 });
    expect(linkClickSpy).toHaveBeenCalledTimes(1);

    // Click when selection is NOT collapsed should not trigger link click
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false });
    fireEvent.click(page1, { clientX: 30, clientY: 30 });
    expect(linkClickSpy).toHaveBeenCalledTimes(1);

    // Duplicate IntersectionObserver event for already-visible page is a no-op
    act(() => {
      ioCallback([{ target: page1, isIntersecting: true }]);
    });

    // Scroll offscreen clears rendered DOM
    act(() => {
      ioCallback([{ target: page1, isIntersecting: false }]);
      ioCallback([{ target: page1, isIntersecting: false }]);
    });
    expect(page1.dataset.rendered).toBeUndefined();
    expect(page1.children).toHaveLength(0);
    expect(page2).toBeInTheDocument();
  });

  it('cancels in-flight PDF load cleanly when unmounted', async () => {
    let resolveDoc;
    const destroy = vi.fn().mockResolvedValue(undefined);
    const loader = vi.fn().mockResolvedValue({
      getDocument: () => ({
        promise: new Promise(resolve => { resolveDoc = resolve; })
      })
    });

    const { unmount } = render(
      <PdfReader
        paperId="p-slow"
        zoom={1}
        initialPosition={{ page: 1, offset: 0 }}
        onScroll={vi.fn()}
        pagesContainerRef={createRef()}
        readerApiRef={createRef()}
        pdfjsLoader={loader}
      />
    );

    await waitFor(() => {
      expect(resolveDoc).toBeTypeOf('function');
    });
    unmount();
    await act(async () => {
      resolveDoc({ numPages: 1, destroy, getPage: vi.fn() });
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('cancels in-flight page render cleanly when unmounted', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    let resolveRender;
    let pageCalls = 0;
    const doc = {
      numPages: 1,
      destroy: vi.fn().mockResolvedValue(undefined),
      getPage: vi.fn().mockImplementation(async () => {
        pageCalls++;
        return {
          view: [0, 0, 600, 800],
          getViewport: ({ scale }) => ({
            width: 600 * scale,
            height: 800 * scale,
            clone: () => ({ width: 600 * scale, height: 800 * scale })
          }),
          render: () => ({
            promise: pageCalls >= 2
              ? new Promise(resolve => { resolveRender = resolve; })
              : Promise.resolve()
          }),
          streamTextContent: () => ({}),
          getAnnotations: async () => []
        };
      })
    };
    const loader = vi.fn().mockResolvedValue({
      getDocument: () => ({ promise: Promise.resolve(doc) }),
      TextLayer: class { async render() {} },
      AnnotationLayer: class { async render() {} }
    });

    const { unmount } = render(
      <PdfReader
        paperId="p-cancel-render"
        zoom={1}
        initialPosition={{ page: 1, offset: 0 }}
        onScroll={vi.fn()}
        pagesContainerRef={createRef()}
        readerApiRef={createRef()}
        pdfjsLoader={loader}
      />
    );

    await waitFor(() => {
      expect(resolveRender).toBeTypeOf('function');
    });
    unmount();
    await act(async () => {
      resolveRender();
    });
  });

  it('shows open error, page render error, and handles ResizeObserver debounced reflow', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    let roCallback = null;
    class MockResizeObserver {
      constructor(cb) {
        roCallback = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});

    const { loader: failOpenLoader } = createMockPdfjs({ failOpen: true });

    const { rerender } = render(
      <PdfReader
        paperId="bad-pdf"
        zoom={1}
        initialPosition={{ page: 1, offset: 0 }}
        onScroll={vi.fn()}
        pagesContainerRef={createRef()}
        readerApiRef={createRef()}
        pdfjsLoader={failOpenLoader}
      />
    );
    expect(await screen.findByText('Unable to open PDF: Invalid PDF')).toBeInTheDocument();

    // Switch to a valid PDF whose page 1 render rejects
    let callCount = 0;
    const { loader: renderFailLoader } = createMockPdfjs({ numPages: 1 });
    const origLoader = renderFailLoader;
    const failingRenderLoader = vi.fn().mockImplementation(async () => {
      const mod = await origLoader();
      const origGetDoc = mod.getDocument;
      return {
        ...mod,
        getDocument: url => {
          const task = origGetDoc(url);
          return {
            promise: task.promise.then(doc => ({
              ...doc,
              getPage: async num => {
                const page = await doc.getPage(num);
                callCount++;
                if (callCount === 2) {
                  return {
                    ...page,
                    render: () => ({ promise: Promise.reject(new Error('Canvas failed')) })
                  };
                }
                return page;
              }
            }))
          };
        }
      };
    });

    rerender(
      <PdfReader
        paperId="render-fail"
        zoom={1}
        initialPosition={{ page: 1, offset: 0 }}
        onScroll={vi.fn()}
        pagesContainerRef={createRef()}
        readerApiRef={createRef()}
        pdfjsLoader={failingRenderLoader}
      />
    );
    expect(await screen.findByText('Unable to render page: Canvas failed')).toBeInTheDocument();

    // Trigger ResizeObserver with same width (no-op) then new width
    vi.useFakeTimers();
    const readerEl = document.getElementById('reader');
    act(() => {
      roCallback();
    });
    Object.defineProperty(readerEl, 'clientWidth', { value: 640, configurable: true });
    act(() => {
      roCallback();
      vi.advanceTimersByTime(350);
    });
    vi.useRealTimers();

    // Close paper -> shows default empty state
    rerender(
      <PdfReader
        paperId={null}
        zoom={1}
        initialPosition={null}
        onScroll={vi.fn()}
        pagesContainerRef={createRef()}
        readerApiRef={createRef()}
        pdfjsLoader={failOpenLoader}
      />
    );
    expect(screen.getByText('Your papers, in one place.')).toBeInTheDocument();
  });
});
