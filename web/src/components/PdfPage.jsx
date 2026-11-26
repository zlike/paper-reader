import { useCallback, useEffect, useRef } from 'react';
import { isSupportedLink } from '../lib/pdf-links.js';

export function PdfPage({
  pageNumber,
  width,
  height,
  isVisible,
  pdfDoc,
  pdfjs,
  layoutKey,
  onNavigateDestination,
  onLinkError,
  registerElement,
  onRendered
}) {
  const containerRef = useRef(null);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  const setContainerRef = useCallback(node => {
    containerRef.current = node;
    registerElement?.(pageNumber, node);
  }, [pageNumber, registerElement]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    if (!isVisible || !pdfDoc || !pdfjs) {
      element.replaceChildren();
      delete element.dataset.rendered;
      return undefined;
    }

    let cancelled = false;
    element.dataset.rendering = 'true';

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || !element.isConnected) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = width / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);

        const text = document.createElement('div');
        text.className = 'textLayer';
        text.style.setProperty('--scale-factor', String(scale));

        const annotations = document.createElement('div');
        annotations.className = 'annotationLayer';
        annotations.style.setProperty('--scale-factor', String(scale));

        element.replaceChildren(canvas, text, annotations);

        const context = canvas.getContext('2d');
        await page.render({
          canvasContext: context,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0]
        }).promise;
        if (cancelled || !element.isConnected) return;

        await new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: text,
          viewport
        }).render();
        if (cancelled || !element.isConnected) return;

        const rawAnnotations = await page.getAnnotations();
        if (cancelled || !element.isConnected) return;
        const links = rawAnnotations.filter(isSupportedLink);

        const linkService = {
          addLinkAttributes(link, url) {
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          },
          getDestinationHash: () => '#',
          getAnchorUrl: () => '#',
          goToDestination: destination => {
            onNavigateDestination(pdfDoc, destination).catch(error => {
              if (!cancelled) onLinkError(error);
            });
          },
          executeNamedAction: action => {
            const target = {
              FirstPage: 1,
              LastPage: pdfDoc.numPages,
              NextPage: pageNumber + 1,
              PrevPage: pageNumber - 1
            }[action];
            if (target >= 1 && target <= pdfDoc.numPages) {
              onNavigateDestination(pdfDoc, [target - 1, { name: 'Fit' }]).catch(error => {
                if (!cancelled) onLinkError(error);
              });
            }
          }
        };

        await new pdfjs.AnnotationLayer({
          div: annotations,
          page,
          viewport: viewport.clone({ dontFlip: true })
        }).render({ annotations: links, linkService });

        if (cancelled || !element.isConnected) return;

        for (const link of annotations.querySelectorAll('.linkAnnotation > a')) {
          link.setAttribute(
            'aria-label',
            link.target === '_blank' ? 'Open external link in a new tab' : 'Go to link in this paper'
          );
        }
        element.dataset.rendered = 'true';
        onRenderedRef.current?.(pageNumber, element);
      } catch (error) {
        if (!cancelled && element.isConnected) {
          element.textContent = `Unable to render page: ${error.message}`;
        }
      } finally {
        delete element.dataset.rendering;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isVisible, pdfDoc, pdfjs, pageNumber, width, layoutKey, onNavigateDestination, onLinkError]);

  return (
    <div
      ref={setContainerRef}
      className="page"
      data-page={pageNumber}
      aria-label={`Page ${pageNumber}`}
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}
