import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sanitizeTitleForSearch } from '../lib/dehyphenate.js';
import { computePreviewTarget, findLinkAtPoint, resolveDestination } from '../lib/pdf-links.js';
import { clearTargetHighlights, highlightLinkTarget } from '../lib/link-highlight.js';
import { useLinkHover } from '../hooks/useLinkHover.js';
import { useTextSelection } from '../hooks/useTextSelection.js';
import { PdfPage } from './PdfPage.jsx';

export function LinkPreviewDialog({
  open,
  pdfDoc,
  pdfjs,
  destination,
  requestId,
  onClose,
  onJumpToTarget,
  onFindCitation,
  onNavigateInternal
}) {
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const previewPagesRef = useRef(null);
  const renderedPagesRef = useRef(new Map());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewState, setPreviewState] = useState(null);
  const [highlightedTitle, setHighlightedTitle] = useState('');

  const {
    selectedText,
    visible: showFindSelection,
    dismissSelection
  } = useTextSelection(previewPagesRef);

  const clearModalSelection = useCallback(() => {
    const selection = window.getSelection?.();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      dialogRef.current?.contains(selection.anchorNode)
    ) {
      selection.removeAllRanges?.();
    }
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
    } else {
      clearTargetHighlights(previewPagesRef.current);
      renderedPagesRef.current.clear();
      clearModalSelection();
      dismissSelection();
      setError('');
      setPreviewState(null);
      setHighlightedTitle('');
      setLoading(false);
      if (dialog.open && typeof dialog.close === 'function') {
        dialog.close();
      }
    }
  }, [open, requestId, dismissSelection, clearModalSelection]);

  useEffect(() => {
    if (!open || !pdfDoc || destination == null) return undefined;

    let cancelled = false;
    clearTargetHighlights(previewPagesRef.current);
    renderedPagesRef.current.clear();
    setLoading(true);
    setError('');
    setPreviewState(null);
    setHighlightedTitle('');
    dismissSelection();

    (async () => {
      try {
        const resolved = await resolveDestination(pdfDoc, destination);
        if (cancelled) return;
        const page = await pdfDoc.getPage(resolved.pageNumber);
        if (cancelled) return;

        const bodyWidth = bodyRef.current?.clientWidth || Math.min(window.innerWidth - 32, 760);
        const pageWidth = Math.max(220, Math.min(bodyWidth - 24, 860));
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = pageWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });

        const target = computePreviewTarget(
          page,
          viewport,
          resolved.destination,
          resolved.pageNumber,
          pdfDoc.numPages
        );

        const pages = [
          {
            pageNumber: resolved.pageNumber,
            width: pageWidth,
            height: viewport.height
          }
        ];

        if (target.includeNextPage) {
          const nextPage = await pdfDoc.getPage(resolved.pageNumber + 1);
          if (cancelled) return;
          const nextBase = nextPage.getViewport({ scale: 1 });
          pages.push({
            pageNumber: resolved.pageNumber + 1,
            width: pageWidth,
            height: pageWidth * (nextBase.height / nextBase.width)
          });
        }

        setPreviewState({
          resolved,
          pages,
          targetPoint: { x: target.x, y: target.y },
          scrollTop: target.scrollTop,
          scrollLeft: target.scrollLeft,
          requestId
        });
      } catch (err) {
        if (!cancelled) {
          setError(`Unable to preview link: ${err.message}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, pdfDoc, destination, requestId, dismissSelection]);

  useLayoutEffect(() => {
    if (!previewState || !bodyRef.current) return;
    bodyRef.current.scrollTop = previewState.scrollTop;
    bodyRef.current.scrollLeft = previewState.scrollLeft;
  }, [previewState]);

  const handlePageRendered = useCallback((pageNumber, element) => {
    if (!previewState) return;
    renderedPagesRef.current.set(pageNumber, element);

    const targetSlot = previewState.pages[0];
    const targetTextLayer = renderedPagesRef.current.get(targetSlot.pageNumber)?.querySelector('.textLayer');
    if (!targetTextLayer) return;

    const nextSlot = previewState.pages[1];
    const nextTextLayer = nextSlot
      ? renderedPagesRef.current.get(nextSlot.pageNumber)?.querySelector('.textLayer') || null
      : null;

    const result = highlightLinkTarget({
      targetTextLayer,
      nextTextLayer,
      point: previewState.targetPoint
    });
    setHighlightedTitle(result.matchedTitle ? result.searchTitle : '');
  }, [previewState]);

  const handleNativeClose = useCallback(() => {
    if (dialogRef.current?.open) return;
    clearModalSelection();
    dismissSelection();
    onClose();
  }, [clearModalSelection, dismissSelection, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.addEventListener('close', handleNativeClose);
    return () => dialog.removeEventListener('close', handleNativeClose);
  }, [handleNativeClose]);

  const closeDialog = useCallback(() => {
    if (dialogRef.current?.open) {
      dialogRef.current.close();
    } else {
      handleNativeClose();
    }
  }, [handleNativeClose]);

  const handleBackdropClick = useCallback(event => {
    if (event.target === dialogRef.current) {
      closeDialog();
    }
  }, [closeDialog]);

  const handleJumpToPage = useCallback(() => {
    const resolved = previewState.resolved;
    closeDialog();
    onJumpToTarget(resolved);
  }, [previewState, closeDialog, onJumpToTarget]);

  const findQuery = showFindSelection ? sanitizeTitleForSearch(selectedText) : highlightedTitle;
  const showFindButton = Boolean(findQuery);

  const handleFindCitedPaper = useCallback(() => {
    if (!findQuery) return;
    clearModalSelection();
    dismissSelection();
    onFindCitation?.(findQuery, { autoSearch: true });
  }, [findQuery, clearModalSelection, dismissSelection, onFindCitation]);

  const handleInternalNavigate = useCallback(async (_doc, nextDestination) => {
    onNavigateInternal(nextDestination);
  }, [onNavigateInternal]);

  const handleInternalLinkError = useCallback(err => {
    setError(`Unable to preview link: ${err.message}`);
  }, []);

  const linkHoverHandlers = useLinkHover();

  const handlePreviewPagesClick = useCallback(event => {
    if (event.target.closest('.annotationLayer') || !window.getSelection()?.isCollapsed) return;
    const page = event.target.closest('.page');
    findLinkAtPoint(page, event.clientX, event.clientY)?.click();
  }, []);

  const title = previewState
    ? (previewState.pages.length > 1
      ? `Pages ${previewState.pages[0].pageNumber}–${previewState.pages[1].pageNumber}`
      : `Page ${previewState.pages[0].pageNumber}`)
    : 'Link preview';

  return (
    <dialog
      ref={dialogRef}
      id="link-preview-dialog"
      className="link-preview-dialog"
      aria-labelledby="link-preview-title"
      onClick={handleBackdropClick}
    >
      <div className="link-preview-surface">
        <div className="link-preview-header">
          <h2 id="link-preview-title">{title}</h2>
          <div className="link-preview-actions">
            {previewState?.resolved && (
              <button
                id="link-preview-jump"
                type="button"
                className="secondary-btn"
                onClick={handleJumpToPage}
              >
                Jump to page
              </button>
            )}
            <button
              id="close-link-preview"
              type="button"
              className="icon"
              aria-label="Close link preview"
              onClick={closeDialog}
            >
              ✕
            </button>
          </div>
        </div>
        <div ref={bodyRef} id="link-preview-body" className="link-preview-body">
          {loading && (
            <div id="link-preview-loading" role="status" className="link-preview-message">
              Loading link target…
            </div>
          )}
          {error && (
            <div id="link-preview-error" role="alert" className="link-preview-error">
              {error}
            </div>
          )}
          <div
            ref={previewPagesRef}
            id="link-preview-pages"
            className="link-preview-pages"
            onClick={handlePreviewPagesClick}
            {...linkHoverHandlers}
          >
            {previewState?.pages.map(slot => (
              <PdfPage
                key={`preview-${previewState.requestId}-${slot.pageNumber}`}
                pageNumber={slot.pageNumber}
                width={slot.width}
                height={slot.height}
                isVisible
                pdfDoc={pdfDoc}
                pdfjs={pdfjs}
                layoutKey={previewState.requestId}
                onNavigateDestination={handleInternalNavigate}
                onLinkError={handleInternalLinkError}
                onRendered={handlePageRendered}
              />
            ))}
          </div>
        </div>
        <button
          id="link-preview-find-selection"
          type="button"
          className="find-selection-btn link-preview-find-btn"
          hidden={!showFindButton}
          onClick={handleFindCitedPaper}
        >
          Find selected paper
        </button>
      </div>
    </dialog>
  );
}
