import { useCallback, useEffect, useRef } from 'react';
import { findLinkAtPoint } from '../lib/pdf-links.js';

export const LINK_HOVER_CLASS = 'page--link-hover';

/**
 * Tracks desktop pointer hover over PDF link annotations while keeping
 * `.annotationLayer section { pointer-events: none; }` so text selection works.
 */
export function useLinkHover() {
  const hoveredPageRef = useRef(null);

  const clearHover = useCallback(() => {
    if (hoveredPageRef.current) {
      hoveredPageRef.current.classList.remove(LINK_HOVER_CLASS);
      hoveredPageRef.current = null;
    }
  }, []);

  useEffect(() => clearHover, [clearHover]);

  const onPointerMove = useCallback(event => {
    if (event.pointerType === 'touch' || event.buttons > 0) {
      clearHover();
      return;
    }
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) {
      clearHover();
      return;
    }

    const page = event.target?.closest?.('.page') || null;
    const nextHoveredPage = findLinkAtPoint(page, event.clientX, event.clientY) ? page : null;

    if (hoveredPageRef.current === nextHoveredPage) return;
    if (hoveredPageRef.current) {
      hoveredPageRef.current.classList.remove(LINK_HOVER_CLASS);
    }
    if (nextHoveredPage) {
      nextHoveredPage.classList.add(LINK_HOVER_CLASS);
    }
    hoveredPageRef.current = nextHoveredPage;
  }, [clearHover]);

  return {
    onPointerMove,
    onPointerLeave: clearHover,
    onPointerDown: clearHover
  };
}
