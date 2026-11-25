import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useSwipeToClose } from '../src/hooks/useSwipeToClose.js';
import { useReadingProgress } from '../src/hooks/useReadingProgress.js';
import { useTextSelection } from '../src/hooks/useTextSelection.js';
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
