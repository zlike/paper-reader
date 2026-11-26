import { useEffect, useRef } from 'react';
import { MAX_ZOOM, MIN_ZOOM, normalizeZoom } from '../lib/reading-progress.js';

export function getTouchDistance(touchA, touchB) {
  return Math.hypot(touchB.clientX - touchA.clientX, touchB.clientY - touchA.clientY);
}

export function getTouchMidpoint(touchA, touchB) {
  return {
    x: (touchA.clientX + touchB.clientX) / 2,
    y: (touchA.clientY + touchB.clientY) / 2
  };
}

export function clampZoomScale(baseZoom, rawScale, minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM) {
  const safeBase = typeof baseZoom === 'number' && Number.isFinite(baseZoom) && baseZoom > 0 ? baseZoom : MIN_ZOOM;
  const safeScale = typeof rawScale === 'number' && Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
  const targetZoom = Math.max(minZoom, Math.min(maxZoom, safeBase * safeScale));
  return {
    targetZoom,
    appliedScale: targetZoom / safeBase
  };
}

export function computeAnchoredScroll({ scrollLeft, scrollTop, focalX, focalY, prevZoom, nextZoom }) {
  const safePrev = typeof prevZoom === 'number' && Number.isFinite(prevZoom) && prevZoom > 0 ? prevZoom : MIN_ZOOM;
  const safeNext = typeof nextZoom === 'number' && Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : safePrev;
  const ratio = safeNext / safePrev;
  const nextScrollLeft = Math.max(0, Math.round((scrollLeft + focalX) * ratio - focalX));
  const nextScrollTop = Math.max(0, Math.round((scrollTop + focalY) * ratio - focalY));
  return { scrollLeft: nextScrollLeft, scrollTop: nextScrollTop };
}

export function wheelDeltaToScale(deltaY) {
  if (typeof deltaY !== 'number' || !Number.isFinite(deltaY) || deltaY === 0) return 1;
  const clamped = Math.max(-0.4, Math.min(0.4, -deltaY * 0.004));
  return Math.exp(clamped);
}

function isInsideReaderContent(readerEl, target) {
  if (!readerEl || !target || !readerEl.contains(target)) return false;
  if (typeof target.closest === 'function' && target.closest('dialog')) return false;
  return true;
}

export function usePinchZoom({
  readerRef,
  pagesRef,
  zoom,
  enabled,
  onCommitZoom,
  wheelCommitDelayMs = 120
}) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onCommitZoomRef = useRef(onCommitZoom);
  onCommitZoomRef.current = onCommitZoom;

  const stateRef = useRef({
    mode: null,
    baseZoom: MIN_ZOOM,
    appliedScale: 1,
    startDistance: 0,
    lastMidX: 0,
    lastMidY: 0,
    focalX: 0,
    focalY: 0,
    wheelTimer: null
  });

  useEffect(() => {
    const clearPreview = () => {
      const pagesEl = pagesRef.current;
      if (pagesEl) {
        pagesEl.style.transform = '';
        pagesEl.style.transformOrigin = '';
        pagesEl.classList.remove('pinching');
      }
    };

    const resetGesture = () => {
      const state = stateRef.current;
      if (state.wheelTimer) {
        clearTimeout(state.wheelTimer);
        state.wheelTimer = null;
      }
      state.mode = null;
      state.appliedScale = 1;
      state.startDistance = 0;
      clearPreview();
    };

    const applyPreview = (readerEl, pagesEl, focalX, focalY, appliedScale) => {
      const originX = readerEl.scrollLeft + focalX;
      const originY = readerEl.scrollTop + focalY;
      pagesEl.style.transformOrigin = `${originX}px ${originY}px`;
      pagesEl.style.transform = `scale(${appliedScale})`;
      pagesEl.classList.add('pinching');
    };

    const commitGesture = () => {
      const state = stateRef.current;
      if (!state.mode) return;
      const prevZoom = state.baseZoom;
      const nextZoom = normalizeZoom(prevZoom * state.appliedScale);
      const { focalX, focalY } = state;
      resetGesture();
      if (nextZoom !== prevZoom) {
        onCommitZoomRef.current?.(nextZoom, { focalX, focalY, prevZoom });
      }
    };

    const getFocalPoint = (readerEl, clientX, clientY) => {
      const rect = readerEl.getBoundingClientRect();
      const x = typeof clientX === 'number' && Number.isFinite(clientX)
        ? clientX - rect.left
        : rect.width / 2;
      const y = typeof clientY === 'number' && Number.isFinite(clientY)
        ? clientY - rect.top
        : rect.height / 2;
      return { focalX: x, focalY: y };
    };

    const handleTouchStart = event => {
      if (!event.touches || event.touches.length < 2) return;
      if (!enabledRef.current) return;
      const readerEl = readerRef.current;
      const pagesEl = pagesRef.current;
      if (!pagesEl || !isInsideReaderContent(readerEl, event.target)) return;

      const [t1, t2] = event.touches;
      const distance = getTouchDistance(t1, t2);
      if (distance <= 0) return;

      event.preventDefault();
      if (stateRef.current.wheelTimer) {
        clearTimeout(stateRef.current.wheelTimer);
        stateRef.current.wheelTimer = null;
      }

      const midpoint = getTouchMidpoint(t1, t2);
      const { focalX, focalY } = getFocalPoint(readerEl, midpoint.x, midpoint.y);
      const state = stateRef.current;
      state.mode = 'touch';
      state.baseZoom = zoomRef.current;
      state.appliedScale = 1;
      state.startDistance = distance;
      state.lastMidX = midpoint.x;
      state.lastMidY = midpoint.y;
      state.focalX = focalX;
      state.focalY = focalY;
      applyPreview(readerEl, pagesEl, focalX, focalY, 1);
    };

    const handleTouchMove = event => {
      if (!event.touches || event.touches.length < 2) return;
      // Always block browser-level multi-touch pinch zoom anywhere in the app.
      event.preventDefault();

      const state = stateRef.current;
      if (state.mode !== 'touch' || !enabledRef.current) return;
      const readerEl = readerRef.current;
      const pagesEl = pagesRef.current;
      if (!readerEl || !pagesEl) return;

      const [t1, t2] = event.touches;
      const distance = getTouchDistance(t1, t2);
      if (distance <= 0 || state.startDistance <= 0) return;

      const midpoint = getTouchMidpoint(t1, t2);
      const dx = midpoint.x - state.lastMidX;
      const dy = midpoint.y - state.lastMidY;
      state.lastMidX = midpoint.x;
      state.lastMidY = midpoint.y;

      readerEl.scrollLeft -= dx;
      readerEl.scrollTop -= dy;

      const { focalX, focalY } = getFocalPoint(readerEl, midpoint.x, midpoint.y);
      state.focalX = focalX;
      state.focalY = focalY;

      const rawScale = distance / state.startDistance;
      const { appliedScale } = clampZoomScale(state.baseZoom, rawScale);
      state.appliedScale = appliedScale;
      applyPreview(readerEl, pagesEl, focalX, focalY, appliedScale);
    };

    const handleTouchEnd = event => {
      if (stateRef.current.mode !== 'touch') return;
      if (!event.touches || event.touches.length < 2) {
        commitGesture();
      }
    };

    const handleTouchCancel = () => {
      if (stateRef.current.mode === 'touch') {
        resetGesture();
      }
    };

    const handleGestureStart = event => {
      event.preventDefault();
      if (!enabledRef.current || stateRef.current.mode === 'touch') return;
      const readerEl = readerRef.current;
      const pagesEl = pagesRef.current;
      if (!pagesEl || !isInsideReaderContent(readerEl, event.target)) return;

      if (stateRef.current.wheelTimer) {
        clearTimeout(stateRef.current.wheelTimer);
        stateRef.current.wheelTimer = null;
      }

      const { focalX, focalY } = getFocalPoint(readerEl, event.clientX, event.clientY);
      const state = stateRef.current;
      state.mode = 'gesture';
      state.baseZoom = zoomRef.current;
      state.appliedScale = 1;
      state.focalX = focalX;
      state.focalY = focalY;
      applyPreview(readerEl, pagesEl, focalX, focalY, 1);
    };

    const handleGestureChange = event => {
      event.preventDefault();
      const state = stateRef.current;
      if (state.mode !== 'gesture' || !enabledRef.current) return;
      const readerEl = readerRef.current;
      const pagesEl = pagesRef.current;
      if (!readerEl || !pagesEl) return;

      const { focalX, focalY } = getFocalPoint(readerEl, event.clientX, event.clientY);
      state.focalX = focalX;
      state.focalY = focalY;

      const { appliedScale } = clampZoomScale(state.baseZoom, event.scale);
      state.appliedScale = appliedScale;
      applyPreview(readerEl, pagesEl, focalX, focalY, appliedScale);
    };

    const handleGestureEnd = event => {
      event.preventDefault();
      if (stateRef.current.mode === 'gesture') {
        commitGesture();
      }
    };

    const handleWheel = event => {
      if (!event.ctrlKey) return;
      // Always block browser-level trackpad pinch / Ctrl+wheel zoom anywhere in the app.
      event.preventDefault();

      if (!enabledRef.current) return;
      const state = stateRef.current;
      if (state.mode === 'touch' || state.mode === 'gesture') return;

      const readerEl = readerRef.current;
      const pagesEl = pagesRef.current;
      if (!pagesEl || !isInsideReaderContent(readerEl, event.target)) return;

      const { focalX, focalY } = getFocalPoint(readerEl, event.clientX, event.clientY);
      if (state.mode !== 'wheel') {
        state.mode = 'wheel';
        state.baseZoom = zoomRef.current;
        state.appliedScale = 1;
      }

      const stepScale = wheelDeltaToScale(event.deltaY);
      const { appliedScale } = clampZoomScale(state.baseZoom, state.appliedScale * stepScale);
      state.appliedScale = appliedScale;
      state.focalX = focalX;
      state.focalY = focalY;
      applyPreview(readerEl, pagesEl, focalX, focalY, appliedScale);

      if (state.wheelTimer) clearTimeout(state.wheelTimer);
      state.wheelTimer = setTimeout(() => {
        commitGesture();
      }, wheelCommitDelayMs);
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    document.addEventListener('gesturestart', handleGestureStart, { passive: false });
    document.addEventListener('gesturechange', handleGestureChange, { passive: false });
    document.addEventListener('gestureend', handleGestureEnd, { passive: false });
    document.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      resetGesture();
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);
      document.removeEventListener('gesturestart', handleGestureStart);
      document.removeEventListener('gesturechange', handleGestureChange);
      document.removeEventListener('gestureend', handleGestureEnd);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [readerRef, pagesRef, wheelCommitDelayMs]);

  // Cancel any in-flight preview gesture if reader zoom is suppressed (e.g. a modal opens).
  useEffect(() => {
    if (enabled) return;
    const state = stateRef.current;
    if (state.wheelTimer) {
      clearTimeout(state.wheelTimer);
      state.wheelTimer = null;
    }
    if (state.mode) {
      state.mode = null;
      state.appliedScale = 1;
      state.startDistance = 0;
      const pagesEl = pagesRef.current;
      if (pagesEl) {
        pagesEl.style.transform = '';
        pagesEl.style.transformOrigin = '';
        pagesEl.classList.remove('pinching');
      }
    }
  }, [enabled, pagesRef]);
}
