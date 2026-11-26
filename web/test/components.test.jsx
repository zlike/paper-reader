import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Header } from '../src/components/Header.jsx';
import { LibraryDrawer } from '../src/components/LibraryDrawer.jsx';
import { CitationDialog } from '../src/components/CitationDialog.jsx';
import { LinkPreviewDialog } from '../src/components/LinkPreviewDialog.jsx';
import { PdfPage } from '../src/components/PdfPage.jsx';
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
    const readerEl = document.getElementById('reader');
    readerEl.scrollTop = 150;
    fireEvent.click(links[1]);
    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    expect(readerEl.scrollTop).toBe(150);

    // Jump to page scrolls main reader and closes preview dialog
    fireEvent.click(screen.getByRole('button', { name: 'Jump to page' }));
    await waitFor(() => {
      expect(document.getElementById('link-preview-dialog')).not.toHaveAttribute('open');
    });

    fireEvent.click(links[4]);
    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    fireEvent.click(links[5]);

    // Trigger broken internal link and throwing destination -> shows error inside preview dialog
    fireEvent.click(links[2]);
    expect(await screen.findByText(/Unable to preview link/)).toBeInTheDocument();
    fireEvent.click(links[3]);
    expect(await screen.findByText('Unable to preview link: Link failed')).toBeInTheDocument();

    // Close preview dialog
    fireEvent.click(screen.getByRole('button', { name: 'Close link preview' }));
    expect(document.getElementById('link-preview-dialog')).not.toHaveAttribute('open');

    // Hit-test click on page outside annotationLayer delegates to matching link
    const linkClickSpy = vi.spyOn(links[1], 'click');
    vi.spyOn(links[0], 'getBoundingClientRect').mockReturnValue({ left: 0, right: 10, top: 0, bottom: 10 });
    vi.spyOn(links[1], 'getBoundingClientRect').mockReturnValue({ left: 20, right: 60, top: 20, bottom: 60 });
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true });

    // Hovering over a link toggles page--link-hover on the hovered page
    fireEvent.pointerMove(page1, { clientX: 30, clientY: 30, pointerType: 'mouse', buttons: 0 });
    expect(page1).toHaveClass('page--link-hover');
    fireEvent.pointerMove(page1, { clientX: 200, clientY: 200, pointerType: 'mouse', buttons: 0 });
    expect(page1).not.toHaveClass('page--link-hover');

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

  it('commits pinch-to-zoom on #reader and anchors scroll position around the focal point', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    const { loader } = createMockPdfjs({ numPages: 2 });
    const onZoomChange = vi.fn();

    const { rerender } = render(
      <PdfReader
        paperId="p-pinch"
        zoom={1}
        initialPosition={{ page: 1, offset: 0 }}
        onScroll={vi.fn()}
        onZoomChange={onZoomChange}
        readerApiRef={createRef()}
        pdfjsLoader={loader}
      />
    );

    const page1 = await screen.findByLabelText('Page 1');
    const readerEl = document.getElementById('reader');
    vi.spyOn(readerEl, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 56, width: 800, height: 600, right: 800, bottom: 656
    });
    readerEl.scrollLeft = 0;
    readerEl.scrollTop = 100;

    // Two-finger pinch on page1 to 1.5x around (400, 256) -> focal (400, 200)
    const startEvt = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(startEvt, 'touches', {
      value: [{ clientX: 350, clientY: 256 }, { clientX: 450, clientY: 256 }]
    });
    const moveEvt = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvt, 'touches', {
      value: [{ clientX: 325, clientY: 256 }, { clientX: 475, clientY: 256 }]
    });
    const endEvt = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(endEvt, 'touches', { value: [] });

    act(() => {
      page1.dispatchEvent(startEvt);
      page1.dispatchEvent(moveEvt);
      page1.dispatchEvent(endEvt);
    });

    expect(onZoomChange).toHaveBeenCalledWith(1.5);

    // Rerender with updated zoom -> layout effect anchors scroll around focal point (400, 200)
    rerender(
      <PdfReader
        paperId="p-pinch"
        zoom={1.5}
        initialPosition={{ page: 1, offset: 0 }}
        onScroll={vi.fn()}
        onZoomChange={onZoomChange}
        readerApiRef={createRef()}
        pdfjsLoader={loader}
      />
    );

    expect(readerEl.scrollLeft).toBe(200);
    expect(readerEl.scrollTop).toBe(250);
  });
});

describe('LinkPreviewDialog', () => {
  function createPreviewPdfDoc({ numPages = 4, annotationsByPage = {} } = {}) {
    const getPage = vi.fn().mockImplementation(async pageNumber => ({
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
    }));

    const doc = {
      numPages,
      getPage,
      getDestination: async name => {
        if (name === 'bottom-p2') return [1, { name: 'XYZ' }, 72, 160, null];
        if (name === 'top-p3') return [2, { name: 'Fit' }];
        if (name === 'broken') return null;
        return null;
      },
      getPageIndex: async () => 1
    };

    class TextLayer {
      constructor({ container }) {
        this.container = container;
      }
      async render() {
        const span = document.createElement('span');
        span.textContent = 'Reference [1] Vaswani et al., Attention Is All You Need';
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
          }
          section.append(a);
          this.div.append(section);
        }
      }
    }

    return { doc, pdfjs: { TextLayer, AnnotationLayer } };
  }

  it('renders target + adjacent next page when near bottom, scrolls to target, supports selection & Find cited paper, internal links, and backdrop dismiss', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    const { doc, pdfjs } = createPreviewPdfDoc({
      numPages: 4,
      annotationsByPage: {
        2: [{ subtype: 'Link', dest: 'top-p3' }]
      }
    });

    const onClose = vi.fn();
    const onJumpToTarget = vi.fn();
    const onFindCitation = vi.fn();
    const onNavigateInternal = vi.fn();

    render(
      <LinkPreviewDialog
        open
        pdfDoc={doc}
        pdfjs={pdfjs}
        destination="bottom-p2"
        requestId={1}
        onClose={onClose}
        onJumpToTarget={onJumpToTarget}
        onFindCitation={onFindCitation}
        onNavigateInternal={onNavigateInternal}
      />
    );

    // Adjacent page included -> title shows Pages 2–3
    expect(await screen.findByText('Pages 2–3')).toBeInTheDocument();
    const previewPages = document.getElementById('link-preview-pages');
    await waitFor(() => {
      expect(previewPages.querySelectorAll('.page')).toHaveLength(2);
      expect(previewPages.querySelector('.page[data-page="2"]').dataset.rendered).toBe('true');
    });

    // Body auto-scrolled to target near bottom of page 2
    expect(document.getElementById('link-preview-body').scrollTop).toBeGreaterThan(0);

    // Selecting text inside preview textLayer shows Find cited paper button inside modal
    const textNode = previewPages.querySelector('.page[data-page="2"] .textLayer span').firstChild;
    const removeAllRanges = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Attention Is All You Need',
      anchorNode: textNode,
      isCollapsed: false,
      removeAllRanges
    });
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    const findBtn = document.getElementById('link-preview-find-selection');
    expect(findBtn).not.toHaveAttribute('hidden');
    fireEvent.click(findBtn);
    expect(removeAllRanges).toHaveBeenCalledTimes(1);
    expect(onFindCitation).toHaveBeenCalledWith('Attention Is All You Need');
    expect(findBtn).toHaveAttribute('hidden');

    // Hit-test click on internal link inside preview triggers onNavigateInternal
    const previewPage2 = previewPages.querySelector('.page[data-page="2"]');
    const internalLink = previewPage2.querySelector('.linkAnnotation > a');
    vi.spyOn(internalLink, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 80, top: 10, bottom: 40 });
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true });
    // Hovering over link in preview toggles page--link-hover
    fireEvent.pointerMove(previewPage2, { clientX: 30, clientY: 20, pointerType: 'mouse', buttons: 0 });
    expect(previewPage2).toHaveClass('page--link-hover');
    fireEvent.pointerLeave(previewPages);
    expect(previewPage2).not.toHaveClass('page--link-hover');
    // Click outside link rect is a no-op
    fireEvent.click(previewPage2, { clientX: 200, clientY: 200 });
    expect(onNavigateInternal).not.toHaveBeenCalled();
    // Click outside any .page is a no-op
    fireEvent.click(previewPages, { clientX: 30, clientY: 20 });
    expect(onNavigateInternal).not.toHaveBeenCalled();
    // Click inside link rect triggers navigation
    fireEvent.click(previewPage2, { clientX: 30, clientY: 20 });
    expect(onNavigateInternal).toHaveBeenCalledWith('top-p3');
    // Click when selection is NOT collapsed is ignored
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false });
    fireEvent.click(previewPage2, { clientX: 30, clientY: 20 });
    expect(onNavigateInternal).toHaveBeenCalledTimes(1);

    // Clicking inside surface does NOT close; clicking dialog backdrop DOES close
    fireEvent.click(document.querySelector('.link-preview-surface'));
    expect(onClose).not.toHaveBeenCalled();

    // Stale native close event while dialog is already open is ignored
    const dialogEl = document.getElementById('link-preview-dialog');
    fireEvent(dialogEl, new Event('close'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialogEl);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles Jump to page, error state, internal link error, and cancellation on close mid-load', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    const { doc, pdfjs } = createPreviewPdfDoc({
      numPages: 3,
      annotationsByPage: {
        3: [{ subtype: 'Link', dest: 'top-p3' }]
      }
    });
    const onClose = vi.fn();
    const onJumpToTarget = vi.fn();
    const failingInternalNav = vi.fn().mockImplementation(() => {
      throw new Error('Internal nav failed');
    });

    const { rerender } = render(
      <LinkPreviewDialog
        open
        pdfDoc={doc}
        pdfjs={pdfjs}
        destination="top-p3"
        requestId={1}
        onClose={onClose}
        onJumpToTarget={onJumpToTarget}
        onNavigateInternal={failingInternalNav}
      />
    );

    expect(await screen.findByText('Page 3')).toBeInTheDocument();
    // Trigger internal link error inside preview dialog
    const previewPages = document.getElementById('link-preview-pages');
    await waitFor(() => {
      expect(previewPages.querySelector('.linkAnnotation > a')).toBeTruthy();
    });
    fireEvent.click(previewPages.querySelector('.linkAnnotation > a'));
    expect(await screen.findByText('Unable to preview link: Internal nav failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Jump to page' }));
    expect(onJumpToTarget).toHaveBeenCalledWith({ pageNumber: 3, destination: [2, { name: 'Fit' }] });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Closing via prop while dialog is open calls dialog.close() and resets cleanly
    const { rerender: rerenderClose } = render(
      <LinkPreviewDialog
        open
        pdfDoc={doc}
        pdfjs={pdfjs}
        destination="top-p3"
        requestId={2}
        onClose={onClose}
        onJumpToTarget={onJumpToTarget}
      />
    );
    expect(await screen.findByText('Page 3')).toBeInTheDocument();
    rerenderClose(
      <LinkPreviewDialog
        open={false}
        pdfDoc={doc}
        pdfjs={pdfjs}
        destination="top-p3"
        requestId={2}
        onClose={onClose}
        onJumpToTarget={onJumpToTarget}
      />
    );
    expect(document.querySelectorAll('#link-preview-dialog')[1]).not.toHaveAttribute('open');

    // Broken destination shows error and hides Jump to page
    rerender(
      <LinkPreviewDialog
        open
        pdfDoc={doc}
        pdfjs={pdfjs}
        destination="broken"
        requestId={3}
        onClose={onClose}
        onJumpToTarget={onJumpToTarget}
      />
    );
    expect(await screen.findByText(/Unable to preview link/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jump to page' })).not.toBeInTheDocument();

    // Cancellation while resolveDestination is pending and while getPage is pending
    let resolvePending;
    const slowDoc = {
      ...doc,
      getDestination: () => new Promise(resolve => { resolvePending = resolve; })
    };
    const { unmount } = render(
      <LinkPreviewDialog
        open
        pdfDoc={slowDoc}
        pdfjs={pdfjs}
        destination="slow"
        requestId={4}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Loading link target…')).toBeInTheDocument();
    unmount();
    await act(async () => {
      resolvePending([0, { name: 'Fit' }]);
    });

    let resolvePage;
    const slowPageDoc = {
      ...doc,
      getDestination: async () => [0, { name: 'Fit' }],
      getPage: () => new Promise(resolve => { resolvePage = resolve; })
    };
    const { unmount: unmount2 } = render(
      <LinkPreviewDialog
        open
        pdfDoc={slowPageDoc}
        pdfjs={pdfjs}
        destination="slow-page"
        requestId={5}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => expect(resolvePage).toBeTypeOf('function'));
    unmount2();
    await act(async () => {
      resolvePage(await doc.getPage(1));
    });
  });

  it('updates preview when tapping an internal link inside LinkPreviewDialog hosted by PdfReader and handles jump errors', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    const { doc, pdfjs } = createPreviewPdfDoc({
      numPages: 3,
      annotationsByPage: {
        1: [{ subtype: 'Link', dest: 'bottom-p2' }],
        2: [{ subtype: 'Link', dest: 'top-p3' }]
      }
    });
    doc.destroy = vi.fn().mockResolvedValue(undefined);
    const loader = vi.fn().mockResolvedValue({
      getDocument: () => ({ promise: Promise.resolve(doc) }),
      TextLayer: pdfjs.TextLayer,
      AnnotationLayer: pdfjs.AnnotationLayer
    });

    render(
      <PdfReader
        paperId="nested-links"
        zoom={1}
        initialPosition={{ page: 1, offset: 0 }}
        onScroll={vi.fn()}
        pagesContainerRef={createRef()}
        readerApiRef={createRef()}
        pdfjsLoader={loader}
      />
    );

    const page1 = await screen.findByLabelText('Page 1');
    await waitFor(() => {
      expect(page1.querySelector('.linkAnnotation > a')).toBeTruthy();
    });

    // Click link on page 1 -> opens preview on Pages 2–3
    fireEvent.click(page1.querySelector('.linkAnnotation > a'));
    expect(await screen.findByText('Pages 2–3')).toBeInTheDocument();

    // Click internal link inside preview page 2 -> updates preview to Page 3
    const previewPages = document.getElementById('link-preview-pages');
    await waitFor(() => {
      expect(previewPages.querySelector('.page[data-page="2"] .linkAnnotation > a')).toBeTruthy();
    });
    fireEvent.click(previewPages.querySelector('.page[data-page="2"] .linkAnnotation > a'));
    expect(await screen.findByText('Page 3')).toBeInTheDocument();

    // Force getPage failure during Jump to page -> displays reader status error
    doc.getPage.mockRejectedValueOnce(new Error('Jump failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Jump to page' }));
    expect(await screen.findByText('Unable to follow PDF link: Jump failed')).toBeInTheDocument();
  });

  it('reports named-action navigation errors from PdfPage', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    const { doc, pdfjs } = createPreviewPdfDoc({
      numPages: 2,
      annotationsByPage: {
        1: [{ subtype: 'Link', action: 'NextPage' }]
      }
    });
    class NamedActionAnnotationLayer {
      constructor({ div }) {
        this.div = div;
      }
      async render({ annotations, linkService }) {
        for (const ann of annotations) {
          const section = document.createElement('section');
          section.className = 'linkAnnotation';
          const a = document.createElement('a');
          a.href = linkService.getAnchorUrl();
          a.addEventListener('click', e => {
            e.preventDefault();
            linkService.executeNamedAction(ann.action);
          });
          section.append(a);
          this.div.append(section);
        }
      }
    }
    const onLinkError = vi.fn();
    render(
      <PdfPage
        pageNumber={1}
        width={600}
        height={800}
        isVisible
        pdfDoc={doc}
        pdfjs={{ TextLayer: pdfjs.TextLayer, AnnotationLayer: NamedActionAnnotationLayer }}
        layoutKey={1}
        onNavigateDestination={() => Promise.reject(new Error('Action failed'))}
        onLinkError={onLinkError}
      />
    );
    const page1 = await screen.findByLabelText('Page 1');
    await waitFor(() => {
      expect(page1.querySelector('.linkAnnotation > a')).toBeTruthy();
    });
    fireEvent.click(page1.querySelector('.linkAnnotation > a'));
    await waitFor(() => {
      expect(onLinkError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Action failed' }));
    });
  });
});
