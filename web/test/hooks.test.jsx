import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useSwipeToClose } from '../src/hooks/useSwipeToClose.js';
import { useReadingProgress } from '../src/hooks/useReadingProgress.js';
import { useTextSelection } from '../src/hooks/useTextSelection.js';
import { LINK_HOVER_CLASS, useLinkHover } from '../src/hooks/useLinkHover.js';
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
