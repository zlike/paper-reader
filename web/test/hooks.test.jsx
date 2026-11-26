import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useSwipeToClose } from '../src/hooks/useSwipeToClose.js';
import { useReadingProgress } from '../src/hooks/useReadingProgress.js';
import { useTextSelection } from '../src/hooks/useTextSelection.js';
import { LINK_HOVER_CLASS, useLinkHover } from '../src/hooks/useLinkHover.js';
import {
  clampZoomScale,
  computeAnchoredScroll,
  getTouchDistance,
  getTouchMidpoint,
  usePinchZoom,
  wheelDeltaToScale
} from '../src/hooks/usePinchZoom.js';
import { STORAGE_KEY } from '../src/lib/reading-progress.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useSwipeToClose', () => {
  it('closes on horizontal swipe left exceeding threshold', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToClose({ enabled: true, onClose, threshold: 50 }));

    act(() => {
      result.current.handlers.onTouchStart({ touches: [{ clientX: 200, clientY: 100 }] });
      result.current.handlers.onTouchMove({ touches: [{ clientX: 120, clientY: 102 }] });
    });
    expect(result.current.isSwiping).toBe(true);
    expect(result.current.offsetX).toBe(-80);

    act(() => {
      result.current.handlers.onTouchEnd();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.isSwiping).toBe(false);
    expect(result.current.offsetX).toBe(0);
  });

  it('ignores short swipes, vertical scrolls, disabled state, and cancels cleanly', () => {
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => useSwipeToClose({ enabled, onClose, threshold: 60 }),
      { initialProps: { enabled: true } }
    );

    // Vertical scroll should not activate horizontal swipe
    act(() => {
      result.current.handlers.onTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
      result.current.handlers.onTouchMove({ touches: [{ clientX: 98, clientY: 140 }] });
      result.current.handlers.onTouchMove({ touches: [{ clientX: 20, clientY: 150 }] });
      result.current.handlers.onTouchEnd();
    });
    expect(onClose).not.toHaveBeenCalled();

    // Short horizontal swipe below threshold snaps back without closing
    act(() => {
      result.current.handlers.onTouchStart({ touches: [{ clientX: 200, clientY: 100 }] });
      result.current.handlers.onTouchMove({ touches: [{ clientX: 195, clientY: 100 }] });
      result.current.handlers.onTouchMove({ touches: [{ clientX: 170, clientY: 100 }] });
      result.current.handlers.onTouchEnd();
    });
    expect(onClose).not.toHaveBeenCalled();

    // Touch cancel resets state
    act(() => {
      result.current.handlers.onTouchStart({ touches: [{ clientX: 200, clientY: 100 }] });
      result.current.handlers.onTouchMove({ touches: [{ clientX: 120, clientY: 100 }] });
      result.current.handlers.onTouchCancel();
    });
    expect(result.current.isSwiping).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    // Disabled ignores touches
    rerender({ enabled: false });
    act(() => {
      result.current.handlers.onTouchStart({ touches: [{ clientX: 200, clientY: 100 }] });
      result.current.handlers.onTouchMove({ touches: [{ clientX: 50, clientY: 100 }] });
      result.current.handlers.onTouchEnd();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useReadingProgress', () => {
  it('reconciles server state, debounces scroll saves, deduplicates, and flushes', () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useReadingProgress({ debounceMs: 200 }));

    act(() => {
      result.current.reconcileWithServer(
        { lastPaperId: 'p1', positions: { p1: { page: 2, offset: 0.3, zoom: 1.25, last_opened_at: '2026-11-25T10:00:00Z' } } },
        new Set(['p1'])
      );
    });
    expect(result.current.readingState.lastPaperId).toBe('p1');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).lastPaperId).toBe('p1');

    // Debounced scheduleSave
    let currentPos = { page: 3, offset: 0.4 };
    act(() => {
      result.current.scheduleSave('p1', () => currentPos, 1.25, id => id === 'p1');
      currentPos = { page: 3, offset: 0.6 };
      result.current.scheduleSave('p1', () => currentPos, 1.25, id => id === 'p1');
    });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Identical payload is deduplicated unless keepalive is true
    act(() => {
      result.current.sendProgress('p1', { page: 3, offset: 0.6, zoom: 1.25, opened: true });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Flush with opened: false preserves existing last_opened_at
    act(() => {
      result.current.flushSave('p1', () => ({ page: 4, offset: 0.1 }), 1.25, { opened: false });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.readingState.positions.p1.page).toBe(4);

    // Debounce callback skips save if active paper changed before timer fired
    act(() => {
      result.current.scheduleSave('p1', () => ({ page: 5, offset: 0 }), 1, () => false);
      vi.advanceTimersByTime(200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Null paperId / null position no-ops safely
    act(() => {
      result.current.scheduleSave(null, () => currentPos, 1);
      result.current.scheduleSave('p1', () => null, 1);
      result.current.flushSave(null, () => currentPos, 1);
      result.current.flushSave('p1', () => null, 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
  });
});

describe('useTextSelection', () => {
  function SelectionHarness() {
    const containerRef = useRef(null);
    const { selectedText, visible, dismissSelection } = useTextSelection(containerRef);
    return (
      <div>
        <div ref={containerRef} data-testid="inside">Inside PDF text</div>
        <div data-testid="outside">Outside text</div>
        <span data-testid="selected">{visible ? selectedText : ''}</span>
        <button type="button" onClick={dismissSelection}>Dismiss</button>
      </div>
    );
  }

  it('tracks selection inside container and ignores selection outside', () => {
    const { getByTestId, getByText } = render(<SelectionHarness />);
    const insideNode = getByTestId('inside').firstChild;
    const outsideNode = getByTestId('outside').firstChild;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '  Cited Paper Title  ',
      anchorNode: insideNode
    });
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(getByTestId('selected')).toHaveTextContent('Cited Paper Title');

    fireEvent.click(getByText('Dismiss'));
    expect(getByTestId('selected')).toHaveTextContent('');

    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Outside text',
      anchorNode: outsideNode
    });
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(getByTestId('selected')).toHaveTextContent('');
  });
});

describe('useLinkHover', () => {
  function HoverHarness() {
    const handlers = useLinkHover();
    return (
      <div data-testid="pages" {...handlers}>
        <div className="page" data-testid="page-1">
          <div className="annotationLayer">
            <section className="linkAnnotation">
              <a data-testid="link-1" href="#p2">Link 1</a>
            </section>
          </div>
        </div>
        <div className="page" data-testid="page-2">
          <div className="annotationLayer">
            <section className="linkAnnotation">
              <a data-testid="link-2" href="#p1">Link 2</a>
            </section>
          </div>
        </div>
      </div>
    );
  }

  it('toggles page--link-hover on desktop hover and clears on leave, press, drag, touch, selection, and unmount', () => {
    const { getByTestId, unmount } = render(<HoverHarness />);
    const pages = getByTestId('pages');
    const page1 = getByTestId('page-1');
    const page2 = getByTestId('page-2');
    const link1 = getByTestId('link-1');
    const link2 = getByTestId('link-2');

    vi.spyOn(link1, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 60, top: 10, bottom: 30 });
    vi.spyOn(link2, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 60, top: 100, bottom: 130 });
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true });

    // Hover over link 1 -> adds class
    fireEvent.pointerMove(page1, { clientX: 25, clientY: 20, pointerType: 'mouse', buttons: 0 });
    expect(page1).toHaveClass(LINK_HOVER_CLASS);

    // Repeating pointerMove on same link is a no-op
    fireEvent.pointerMove(page1, { clientX: 30, clientY: 20, pointerType: 'mouse', buttons: 0 });
    expect(page1).toHaveClass(LINK_HOVER_CLASS);

    // Moving directly to link on page 2 transfers the class cleanly
    fireEvent.pointerMove(page2, { clientX: 25, clientY: 115, pointerType: 'mouse', buttons: 0 });
    expect(page1).not.toHaveClass(LINK_HOVER_CLASS);
    expect(page2).toHaveClass(LINK_HOVER_CLASS);

    // Moving off link on page 2 clears class
    fireEvent.pointerMove(page2, { clientX: 200, clientY: 200, pointerType: 'mouse', buttons: 0 });
    expect(page2).not.toHaveClass(LINK_HOVER_CLASS);

    // Pointer down while hovered clears class immediately (starting drag selection)
    fireEvent.pointerMove(page1, { clientX: 25, clientY: 20, pointerType: 'mouse', buttons: 0 });
    expect(page1).toHaveClass(LINK_HOVER_CLASS);
    fireEvent.pointerDown(page1, { clientX: 25, clientY: 20, pointerType: 'mouse', buttons: 1 });
    expect(page1).not.toHaveClass(LINK_HOVER_CLASS);

    // Dragging with mouse button held down does not activate hover
    fireEvent.pointerMove(page1, { clientX: 25, clientY: 20, pointerType: 'mouse', buttons: 1 });
    expect(page1).not.toHaveClass(LINK_HOVER_CLASS);

    // Touch pointer is ignored
    fireEvent.pointerMove(page1, { clientX: 25, clientY: 20, pointerType: 'touch', buttons: 0 });
    expect(page1).not.toHaveClass(LINK_HOVER_CLASS);

    // Non-collapsed text selection clears hover
    fireEvent.pointerMove(page1, { clientX: 25, clientY: 20, pointerType: 'mouse', buttons: 0 });
    expect(page1).toHaveClass(LINK_HOVER_CLASS);
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false });
    fireEvent.pointerMove(page1, { clientX: 25, clientY: 20, pointerType: 'mouse', buttons: 0 });
    expect(page1).not.toHaveClass(LINK_HOVER_CLASS);

    // Pointer leave clears hover
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true });
    fireEvent.pointerMove(page1, { clientX: 25, clientY: 20, pointerType: 'mouse', buttons: 0 });
    expect(page1).toHaveClass(LINK_HOVER_CLASS);
    fireEvent.pointerLeave(pages);
    expect(page1).not.toHaveClass(LINK_HOVER_CLASS);

    // Unmount while hovered cleans up class
    fireEvent.pointerMove(page1, { clientX: 25, clientY: 20, pointerType: 'mouse', buttons: 0 });
    expect(page1).toHaveClass(LINK_HOVER_CLASS);
    unmount();
    expect(page1).not.toHaveClass(LINK_HOVER_CLASS);
  });
});

describe('usePinchZoom', () => {
  function createTouchEvent(type, touches) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: touches });
    return event;
  }

  function createGestureEvent(type, { scale = 1, clientX, clientY } = {}) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'scale', { value: scale });
    if (clientX !== undefined) Object.defineProperty(event, 'clientX', { value: clientX });
    if (clientY !== undefined) Object.defineProperty(event, 'clientY', { value: clientY });
    return event;
  }

  function PinchHarness({ zoom = 1, enabled = true, onCommitZoom, wheelCommitDelayMs = 100 }) {
    const readerRef = useRef(null);
    const pagesRef = useRef(null);
    usePinchZoom({ readerRef, pagesRef, zoom, enabled, onCommitZoom, wheelCommitDelayMs });
    return (
      <div>
        <header data-testid="header">Header</header>
        <main id="reader" ref={readerRef} data-testid="reader">
          <div id="pages" ref={pagesRef} data-testid="pages">
            <div className="page" data-testid="page">Page content</div>
          </div>
          <dialog data-testid="modal">
            <div data-testid="modal-inner">Modal content</div>
          </dialog>
        </main>
      </div>
    );
  }

  it('computes touch distance, midpoint, clamping, anchored scroll, and wheel scale math', () => {
    expect(getTouchDistance({ clientX: 0, clientY: 0 }, { clientX: 30, clientY: 40 })).toBe(50);
    expect(getTouchMidpoint({ clientX: 10, clientY: 20 }, { clientX: 30, clientY: 60 })).toEqual({ x: 20, y: 40 });

    expect(clampZoomScale(1, 1.5)).toEqual({ targetZoom: 1.5, appliedScale: 1.5 });
    expect(clampZoomScale(2, 2)).toEqual({ targetZoom: 2.5, appliedScale: 1.25 });
    expect(clampZoomScale(1.2, 0.5)).toEqual({ targetZoom: 1, appliedScale: 1 / 1.2 });
    expect(clampZoomScale(Number.NaN, -1)).toEqual({ targetZoom: 1, appliedScale: 1 });

    expect(computeAnchoredScroll({
      scrollLeft: 0,
      scrollTop: 100,
      focalX: 400,
      focalY: 200,
      prevZoom: 1,
      nextZoom: 1.5
    })).toEqual({ scrollLeft: 200, scrollTop: 250 });
    expect(computeAnchoredScroll({
      scrollLeft: 0,
      scrollTop: 0,
      focalX: 50,
      focalY: 50,
      prevZoom: 0,
      nextZoom: Number.NaN
    })).toEqual({ scrollLeft: 0, scrollTop: 0 });

    expect(wheelDeltaToScale(0)).toBe(1);
    expect(wheelDeltaToScale(Number.NaN)).toBe(1);
    expect(wheelDeltaToScale(-50)).toBeGreaterThan(1);
    expect(wheelDeltaToScale(50)).toBeLessThan(1);
    expect(wheelDeltaToScale(-1000)).toBeCloseTo(Math.exp(0.4), 5);
    expect(wheelDeltaToScale(1000)).toBeCloseTo(Math.exp(-0.4), 5);
  });

  it('handles two-finger touch pinch preview, panning, clamping, commit, and cancel', () => {
    const onCommitZoom = vi.fn();
    const { getByTestId } = render(<PinchHarness zoom={1} onCommitZoom={onCommitZoom} />);
    const reader = getByTestId('reader');
    const pages = getByTestId('pages');
    const page = getByTestId('page');

    vi.spyOn(reader, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 56, width: 800, height: 600, right: 800, bottom: 656
    });
    reader.scrollLeft = 40;
    reader.scrollTop = 100;

    // Single touch is ignored
    const singleTouch = createTouchEvent('touchstart', [{ clientX: 100, clientY: 156 }]);
    page.dispatchEvent(singleTouch);
    expect(singleTouch.defaultPrevented).toBe(false);

    // Zero-distance two-finger touch is ignored
    const zeroTouch = createTouchEvent('touchstart', [
      { clientX: 100, clientY: 156 },
      { clientX: 100, clientY: 156 }
    ]);
    page.dispatchEvent(zeroTouch);
    expect(zeroTouch.defaultPrevented).toBe(false);

    // Two-finger pinch start (distance = 100, midpoint = (200, 256))
    const startEvt = createTouchEvent('touchstart', [
      { clientX: 150, clientY: 256 },
      { clientX: 250, clientY: 256 }
    ]);
    page.dispatchEvent(startEvt);
    expect(startEvt.defaultPrevented).toBe(true);
    expect(pages).toHaveClass('pinching');

    // Safari gesture events during active touch pinch are prevented without overriding touch state
    const overlappingGesture = createGestureEvent('gesturestart', { scale: 1, clientX: 200, clientY: 256 });
    page.dispatchEvent(overlappingGesture);
    expect(overlappingGesture.defaultPrevented).toBe(true);

    // Move fingers apart (distance = 150 -> 1.5x) and pan midpoint by (+20, -30)
    const moveEvt = createTouchEvent('touchmove', [
      { clientX: 145, clientY: 226 },
      { clientX: 295, clientY: 226 }
    ]);
    page.dispatchEvent(moveEvt);
    expect(moveEvt.defaultPrevented).toBe(true);
    expect(reader.scrollLeft).toBe(20);
    expect(reader.scrollTop).toBe(130);
    expect(pages.style.transform).toBe('scale(1.5)');

    // Lifting one finger ends pinch and commits zoom with focal point
    const endEvt = createTouchEvent('touchend', [{ clientX: 145, clientY: 226 }]);
    page.dispatchEvent(endEvt);
    expect(pages).not.toHaveClass('pinching');
    expect(pages.style.transform).toBe('');
    expect(onCommitZoom).toHaveBeenCalledTimes(1);
    expect(onCommitZoom).toHaveBeenCalledWith(1.5, { focalX: 220, focalY: 170, prevZoom: 1 });

    // Touch cancel resets without committing
    page.dispatchEvent(createTouchEvent('touchstart', [
      { clientX: 100, clientY: 200 },
      { clientX: 200, clientY: 200 }
    ]));
    page.dispatchEvent(createTouchEvent('touchmove', [
      { clientX: 50, clientY: 200 },
      { clientX: 250, clientY: 200 }
    ]));
    expect(pages.style.transform).toBe('scale(2)');
    page.dispatchEvent(new Event('touchcancel', { bubbles: true }));
    expect(pages.style.transform).toBe('');
    expect(onCommitZoom).toHaveBeenCalledTimes(1);
  });

  it('handles Safari gesturestart/gesturechange/gestureend events', () => {
    const onCommitZoom = vi.fn();
    const { getByTestId } = render(<PinchHarness zoom={1} onCommitZoom={onCommitZoom} />);
    const reader = getByTestId('reader');
    const pages = getByTestId('pages');
    const page = getByTestId('page');

    vi.spyOn(reader, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 50, width: 600, height: 800, right: 600, bottom: 850
    });

    const start = createGestureEvent('gesturestart', { scale: 1 });
    page.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
    expect(pages).toHaveClass('pinching');

    const change = createGestureEvent('gesturechange', { scale: 1.4, clientX: 300, clientY: 250 });
    page.dispatchEvent(change);
    expect(change.defaultPrevented).toBe(true);
    expect(pages.style.transform).toBe('scale(1.4)');

    const end = createGestureEvent('gestureend', { scale: 1.4 });
    page.dispatchEvent(end);
    expect(end.defaultPrevented).toBe(true);
    expect(pages).not.toHaveClass('pinching');
    expect(onCommitZoom).toHaveBeenCalledWith(1.4, { focalX: 300, focalY: 200, prevZoom: 1 });
  });

  it('handles ctrl+wheel trackpad pinch with debounced commit and ignores non-ctrl wheel', () => {
    vi.useFakeTimers();
    const onCommitZoom = vi.fn();
    const { getByTestId } = render(
      <PinchHarness zoom={1} onCommitZoom={onCommitZoom} wheelCommitDelayMs={100} />
    );
    const reader = getByTestId('reader');
    const pages = getByTestId('pages');
    const page = getByTestId('page');

    vi.spyOn(reader, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 56, width: 800, height: 600, right: 800, bottom: 656
    });

    // Regular wheel without ctrlKey is untouched
    const normalWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: false });
    page.dispatchEvent(normalWheel);
    expect(normalWheel.defaultPrevented).toBe(false);

    // Ctrl+wheel inside reader applies preview and debounces commit
    const wheel1 = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -50, ctrlKey: true, clientX: 400, clientY: 356
    });
    page.dispatchEvent(wheel1);
    expect(wheel1.defaultPrevented).toBe(true);
    expect(pages).toHaveClass('pinching');
    expect(onCommitZoom).not.toHaveBeenCalled();

    const wheel2 = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -50, ctrlKey: true, clientX: 400, clientY: 356
    });
    page.dispatchEvent(wheel2);
    expect(onCommitZoom).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(pages).not.toHaveClass('pinching');
    expect(pages.style.transform).toBe('');
    expect(onCommitZoom).toHaveBeenCalledTimes(1);
    expect(onCommitZoom.mock.calls[0][0]).toBe(1.5);
    expect(onCommitZoom.mock.calls[0][1]).toEqual({ focalX: 400, focalY: 300, prevZoom: 1 });
  });

  it('prevents browser zoom globally while suppressing PDF zoom outside reader, inside dialogs, or when disabled', () => {
    vi.useFakeTimers();
    const onCommitZoom = vi.fn();
    const { getByTestId, rerender } = render(
      <PinchHarness zoom={1} enabled={true} onCommitZoom={onCommitZoom} wheelCommitDelayMs={100} />
    );
    const header = getByTestId('header');
    const modalInner = getByTestId('modal-inner');
    const page = getByTestId('page');
    const pages = getByTestId('pages');

    // Ctrl+wheel on header prevents default but does not zoom PDF
    const headerWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
    header.dispatchEvent(headerWheel);
    expect(headerWheel.defaultPrevented).toBe(true);

    // Ctrl+wheel inside <dialog> prevents default but does not zoom PDF
    const modalWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
    modalInner.dispatchEvent(modalWheel);
    expect(modalWheel.defaultPrevented).toBe(true);

    // Multi-touch touchmove on header still prevents browser pinch-zoom
    const headerPinch = createTouchEvent('touchmove', [
      { clientX: 10, clientY: 10 },
      { clientX: 80, clientY: 10 }
    ]);
    header.dispatchEvent(headerPinch);
    expect(headerPinch.defaultPrevented).toBe(true);

    // Gesture events on header still prevent browser pinch-zoom
    const headerGesture = createGestureEvent('gesturestart', { scale: 1.2 });
    header.dispatchEvent(headerGesture);
    expect(headerGesture.defaultPrevented).toBe(true);

    // Start a wheel zoom inside reader, then disable (simulating a modal opening mid-gesture)
    page.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -80, ctrlKey: true, clientX: 200, clientY: 200
    }));
    expect(pages).toHaveClass('pinching');

    rerender(<PinchHarness zoom={1} enabled={false} onCommitZoom={onCommitZoom} wheelCommitDelayMs={100} />);
    expect(pages).not.toHaveClass('pinching');
    expect(pages.style.transform).toBe('');

    // While disabled, ctrl+wheel and gesturestart inside reader preventDefault but do not zoom
    const disabledWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
    page.dispatchEvent(disabledWheel);
    expect(disabledWheel.defaultPrevented).toBe(true);

    const disabledGesture = createGestureEvent('gesturestart', { scale: 1.5 });
    page.dispatchEvent(disabledGesture);
    expect(disabledGesture.defaultPrevented).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onCommitZoom).not.toHaveBeenCalled();

    // Re-enable and verify wheel timer is cleared when touchstart or gesturestart interrupts it
    rerender(<PinchHarness zoom={1} enabled={true} onCommitZoom={onCommitZoom} wheelCommitDelayMs={100} />);
    page.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -50, ctrlKey: true, clientX: 200, clientY: 200
    }));
    // Interrupt wheel with touchstart
    page.dispatchEvent(createTouchEvent('touchstart', [
      { clientX: 100, clientY: 200 },
      { clientX: 200, clientY: 200 }
    ]));
    // Wheel during active touch is prevented without overriding touch
    const wheelDuringTouch = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -50, ctrlKey: true, clientX: 200, clientY: 200
    });
    page.dispatchEvent(wheelDuringTouch);
    expect(wheelDuringTouch.defaultPrevented).toBe(true);
    page.dispatchEvent(new Event('touchcancel', { bubbles: true }));

    // Interrupt wheel with gesturestart
    page.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -50, ctrlKey: true, clientX: 200, clientY: 200
    }));
    page.dispatchEvent(createGestureEvent('gesturestart', { scale: 1, clientX: 200, clientY: 200 }));
    page.dispatchEvent(createGestureEvent('gestureend', { scale: 1 }));

    // Gesturechange/gestureend when no gesture is active still preventDefault safely
    const strayChange = createGestureEvent('gesturechange', { scale: 1.2 });
    const strayEnd = createGestureEvent('gestureend', { scale: 1.2 });
    page.dispatchEvent(strayChange);
    page.dispatchEvent(strayEnd);
    expect(strayChange.defaultPrevented).toBe(true);
    expect(strayEnd.defaultPrevented).toBe(true);

    expect(onCommitZoom).not.toHaveBeenCalled();
  });
});
