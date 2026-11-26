import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { loadPdfjs } from '../lib/pdfjs.js';
import { destinationPosition, findLinkAtPoint } from '../lib/pdf-links.js';
import { computeReadingPosition, computeScrollTop } from '../lib/reading-progress.js';
import { useLinkHover } from '../hooks/useLinkHover.js';
import { PdfPage } from './PdfPage.jsx';
import { LinkPreviewDialog } from './LinkPreviewDialog.jsx';

export function PdfReader({
  paperId,
  zoom,
  initialPosition,
  onScroll,
  onFindCitation,
  onPreviewOpenChange,
  pagesContainerRef,
  readerApiRef,
  pdfjsLoader = loadPdfjs
}) {
  const readerRef = useRef(null);
  const pageElementsRef = useRef(new Map());
  const pdfDocRef = useRef(null);
  const pdfjsRef = useRef(null);
  const hasLaidOutRef = useRef(false);
  const isRestoringRef = useRef(false);
  const pendingRestoreRef = useRef(null);
  const prevZoomRef = useRef(zoom);
  const previewRequestIdRef = useRef(0);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfjs, setPdfjs] = useState(null);
  const [pageSlots, setPageSlots] = useState([]);
  const [visiblePages, setVisiblePages] = useState(() => new Set());
  const [readerWidth, setReaderWidth] = useState(0);
  const [layoutKey, setLayoutKey] = useState(0);
  const [openError, setOpenError] = useState('');
  const [readerStatus, setReaderStatus] = useState('');
  const [linkPreview, setLinkPreview] = useState({
    open: false,
    destination: null,
    requestId: 0
  });

  const getPageMetrics = useCallback(() => {
    const reader = readerRef.current;
    if (!reader) return [];
    const readerRect = reader.getBoundingClientRect();
    const metrics = [];
    for (const slot of pageSlots) {
      const element = pageElementsRef.current.get(slot.pageNumber);
      if (!element) continue;
      metrics.push({
        page: slot.pageNumber,
        top: element.getBoundingClientRect().top - readerRect.top + reader.scrollTop,
        height: element.clientHeight || slot.height
      });
    }
    return metrics;
  }, [pageSlots]);

  const getCurrentPosition = useCallback(() => {
    const reader = readerRef.current;
    if (!reader || !hasLaidOutRef.current) return null;
    return computeReadingPosition(getPageMetrics(), reader.scrollTop);
  }, [getPageMetrics]);

  useImperativeHandle(readerApiRef, () => ({
    getCurrentPosition,
    hasLaidOut: () => hasLaidOutRef.current,
    isRestoring: () => isRestoringRef.current
  }), [getCurrentPosition]);

  const registerElement = useCallback((pageNumber, element) => {
    if (element) {
      pageElementsRef.current.set(pageNumber, element);
    } else {
      pageElementsRef.current.delete(pageNumber);
    }
  }, []);

  // Load PDF document when paperId changes.
  useEffect(() => {
    if (!paperId) {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
      hasLaidOutRef.current = false;
      isRestoringRef.current = false;
      pendingRestoreRef.current = null;
      setPdfDoc(null);
      setPageSlots([]);
      setVisiblePages(new Set());
      setOpenError('');
      setReaderStatus('');
      return undefined;
    }

    let cancelled = false;
    hasLaidOutRef.current = false;
    setOpenError('');
    setReaderStatus('');
    setPageSlots([]);
    setVisiblePages(new Set());

    if (pdfDocRef.current) {
      pdfDocRef.current.destroy();
      pdfDocRef.current = null;
    }
    setPdfDoc(null);

    (async () => {
      try {
        const mod = await pdfjsLoader();
        if (cancelled) return;
        pdfjsRef.current = mod;
        setPdfjs(mod);

        const loadingTask = mod.getDocument(`/api/papers/${encodeURIComponent(paperId)}/file`);
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }

        const slots = [];
        for (let number = 1; number <= doc.numPages; number++) {
          const page = await doc.getPage(number);
          if (cancelled) {
            await doc.destroy();
            return;
          }
          const base = page.getViewport({ scale: 1 });
          slots.push({
            pageNumber: number,
            aspectRatio: base.height / base.width
          });
        }

        pdfDocRef.current = doc;
        const width = readerRef.current?.clientWidth || 800;
        setReaderWidth(width);
        pendingRestoreRef.current = initialPosition || { page: 1, offset: 0 };
        setPdfDoc(doc);
        setPageSlots(slots);
        setLayoutKey(k => k + 1);
      } catch (error) {
        if (!cancelled) {
          setOpenError(`Unable to open PDF: ${error.message}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paperId, pdfjsLoader]);

  // Preserve scroll position when zoom changes.
  useEffect(() => {
    if (prevZoomRef.current === zoom) return;
    prevZoomRef.current = zoom;
    if (!pdfDocRef.current || !hasLaidOutRef.current) return;
    const pos = getCurrentPosition();
    pendingRestoreRef.current = pos || { page: 1, offset: 0 };
    setLayoutKey(k => k + 1);
  }, [zoom, getCurrentPosition]);

  // Track reader width changes (debounced 300ms) and restore scroll position.
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || typeof ResizeObserver === 'undefined') return undefined;

    let lastWidth = reader.clientWidth;
    let resizeTimer = null;

    const ro = new ResizeObserver(() => {
      const nextWidth = reader.clientWidth;
      if (nextWidth === lastWidth) return;
      lastWidth = nextWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!pdfDocRef.current) return;
        const pos = getCurrentPosition();
        pendingRestoreRef.current = pos || { page: 1, offset: 0 };
        setReaderWidth(nextWidth);
        setLayoutKey(k => k + 1);
      }, 300);
    });

    ro.observe(reader);
    return () => {
      clearTimeout(resizeTimer);
      ro.disconnect();
    };
  }, [getCurrentPosition]);

  // Restore scroll position synchronously after layout commits.
  useLayoutEffect(() => {
    if (!pageSlots.length || !pendingRestoreRef.current || !readerRef.current) return;
    const target = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    isRestoringRef.current = true;
    const metrics = getPageMetrics();
    readerRef.current.scrollTop = computeScrollTop(metrics, target);
    hasLaidOutRef.current = true;
    requestAnimationFrame(() => {
      isRestoringRef.current = false;
    });
  }, [pageSlots, layoutKey, getPageMetrics]);

  // Virtualize pages via IntersectionObserver.
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || !pageSlots.length) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setVisiblePages(new Set(pageSlots.map(s => s.pageNumber)));
      return undefined;
    }

    const observer = new IntersectionObserver(entries => {
      setVisiblePages(prev => {
        let changed = false;
        const next = new Set(prev);
        for (const entry of entries) {
          const num = Number(entry.target.dataset.page);
          if (entry.isIntersecting && !next.has(num)) {
            next.add(num);
            changed = true;
          } else if (!entry.isIntersecting && next.has(num)) {
            next.delete(num);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, { root: reader, rootMargin: '100% 0px' });

    for (const slot of pageSlots) {
      const el = pageElementsRef.current.get(slot.pageNumber);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [pageSlots, layoutKey]);

  // Close link preview whenever paperId changes.
  useEffect(() => {
    setLinkPreview({ open: false, destination: null, requestId: 0 });
  }, [paperId]);

  useEffect(() => {
    onPreviewOpenChange?.(linkPreview.open);
  }, [linkPreview.open, onPreviewOpenChange]);

  const handleLinkError = useCallback(error => {
    setReaderStatus(`Unable to follow PDF link: ${error.message}`);
  }, []);

  const openLinkPreview = useCallback(async (doc, destination) => {
    if (pdfDocRef.current !== doc) return;
    setReaderStatus('');
    previewRequestIdRef.current += 1;
    setLinkPreview({
      open: true,
      destination,
      requestId: previewRequestIdRef.current
    });
  }, []);

  const handleCloseLinkPreview = useCallback(() => {
    setLinkPreview(prev => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  const handlePreviewNavigateInternal = useCallback(nextDestination => {
    previewRequestIdRef.current += 1;
    setLinkPreview({
      open: true,
      destination: nextDestination,
      requestId: previewRequestIdRef.current
    });
  }, []);

  const jumpToDestination = useCallback(async resolved => {
    const doc = pdfDocRef.current;
    if (!doc) return;
    try {
      const page = await doc.getPage(resolved.pageNumber);
      if (pdfDocRef.current !== doc) return;
      const element = pageElementsRef.current.get(resolved.pageNumber);
      const reader = readerRef.current;
      if (!element || !reader) throw new Error('Destination page is unavailable.');
      const scale = element.clientWidth / page.getViewport({ scale: 1 }).width;
      const point = destinationPosition(page, page.getViewport({ scale }), resolved.destination);
      const pageRect = element.getBoundingClientRect();
      const readerRect = reader.getBoundingClientRect();
      setReaderStatus('');
      reader.scrollTop += pageRect.top - readerRect.top + point.y;
      reader.scrollLeft += pageRect.left - readerRect.left + point.x;
    } catch (error) {
      handleLinkError(error);
    }
  }, [handleLinkError]);

  const linkHoverHandlers = useLinkHover();

  const handlePagesClick = useCallback(event => {
    if (event.target.closest('.annotationLayer') || !window.getSelection()?.isCollapsed) return;
    const page = event.target.closest('.page');
    // Hit-test links after selection so link overlays never block selecting PDF text.
    findLinkAtPoint(page, event.clientX, event.clientY)?.click();
  }, []);

  const handleScroll = useCallback(() => {
    if (!hasLaidOutRef.current || isRestoringRef.current) return;
    onScroll();
  }, [onScroll]);

  const baseWidth = readerWidth > 0 ? readerWidth : 800;
  const pageWidth = Math.max(220, Math.min(baseWidth - 16, 1100)) * zoom;

  const showEmpty = !paperId || Boolean(openError);

  return (
    <main id="reader" ref={readerRef} onScroll={handleScroll}>
      <div id="reader-status" role="status" hidden={!readerStatus}>
        {readerStatus}
      </div>
      <div id="empty" hidden={!showEmpty}>
        {openError ? (
          openError
        ) : (
          <>
            <h2>Your papers, in one place.</h2>
            <p>Search for a paper to start reading.</p>
          </>
        )}
      </div>
      <div id="pages" ref={pagesContainerRef} onClick={handlePagesClick} {...linkHoverHandlers}>
        {pageSlots.map(slot => (
          <PdfPage
            key={`${paperId}-${slot.pageNumber}`}
            pageNumber={slot.pageNumber}
            width={pageWidth}
            height={pageWidth * slot.aspectRatio}
            isVisible={visiblePages.has(slot.pageNumber)}
            pdfDoc={pdfDoc}
            pdfjs={pdfjs}
            layoutKey={layoutKey}
            onNavigateDestination={openLinkPreview}
            onLinkError={handleLinkError}
            registerElement={registerElement}
          />
        ))}
      </div>
      <LinkPreviewDialog
        open={linkPreview.open}
        pdfDoc={pdfDoc}
        pdfjs={pdfjs}
        destination={linkPreview.destination}
        requestId={linkPreview.requestId}
        onClose={handleCloseLinkPreview}
        onJumpToTarget={jumpToDestination}
        onFindCitation={onFindCitation}
        onNavigateInternal={handlePreviewNavigateInternal}
      />
    </main>
  );
}
