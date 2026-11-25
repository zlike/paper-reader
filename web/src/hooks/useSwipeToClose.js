import { useCallback, useRef, useState } from 'react';

export function useSwipeToClose({ enabled, onClose, threshold = 56 }) {
  const gestureRef = useRef(null);
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const reset = useCallback(() => {
    gestureRef.current = null;
    setOffsetX(0);
    setIsSwiping(false);
  }, []);

  const onTouchStart = useCallback(event => {
    if (!enabled || !event.touches || event.touches.length !== 1) return;
    const touch = event.touches[0];
    gestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      direction: null,
      offsetX: 0
    };
  }, [enabled]);

  const onTouchMove = useCallback(event => {
    const gesture = gestureRef.current;
    if (!enabled || !gesture || !event.touches || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;

    if (!gesture.direction) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        gesture.direction = 'vertical';
        return;
      }
      if (dx < -10 && Math.abs(dx) > Math.abs(dy)) {
        gesture.direction = 'horizontal';
        setIsSwiping(true);
      } else {
        return;
      }
    }

    if (gesture.direction === 'horizontal') {
      const clamped = Math.min(0, dx);
      gesture.offsetX = clamped;
      setOffsetX(clamped);
    }
  }, [enabled]);

  const onTouchEnd = useCallback(() => {
    const gesture = gestureRef.current;
    if (gesture && gesture.direction === 'horizontal' && gesture.offsetX <= -threshold) {
      reset();
      onClose();
      return;
    }
    reset();
  }, [onClose, reset, threshold]);

  return {
    offsetX,
    isSwiping,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset
    }
  };
}
