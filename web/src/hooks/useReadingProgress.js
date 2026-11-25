import { useCallback, useEffect, useRef, useState } from 'react';
import { savePaperProgress } from '../lib/api.js';
import {
  loadLocalReadingState,
  mergeReadingStates,
  saveLocalReadingState
} from '../lib/reading-progress.js';

export function useReadingProgress({ debounceMs = 400 } = {}) {
  const [readingState, setReadingState] = useState(() => loadLocalReadingState());
  const readingStateRef = useRef(readingState);
  const saveTimerRef = useRef(null);
  const lastSentKeyRef = useRef('');

  const updateState = useCallback(nextState => {
    readingStateRef.current = nextState;
    setReadingState(nextState);
    saveLocalReadingState(nextState);
    return nextState;
  }, []);

  const reconcileWithServer = useCallback((serverState, validPaperIds) => {
    const merged = mergeReadingStates(serverState, loadLocalReadingState(), validPaperIds);
    return updateState(merged);
  }, [updateState]);

  const recordLocal = useCallback((paperId, { page, offset, zoom, opened = true }) => {
    const now = new Date().toISOString();
    const current = readingStateRef.current;
    const existing = current.positions[paperId];
    const entry = {
      page,
      offset,
      zoom,
      last_opened_at: opened === false && existing?.last_opened_at ? existing.last_opened_at : now,
      updated_at: now
    };
    updateState({
      lastPaperId: opened === false ? (current.lastPaperId ?? paperId) : paperId,
      positions: { ...current.positions, [paperId]: entry }
    });
    return entry;
  }, [updateState]);

  const sendProgress = useCallback((paperId, payload, { keepalive = false } = {}) => {
    const key = `${paperId}:${payload.page}:${payload.offset}:${payload.zoom}:${payload.opened !== false}`;
    if (!keepalive && key === lastSentKeyRef.current) return;
    lastSentKeyRef.current = key;
    savePaperProgress(paperId, payload, { keepalive });
  }, []);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const flushSave = useCallback((paperId, getPosition, zoom, { keepalive = false, opened = true } = {}) => {
    cancelPendingSave();
    if (!paperId) return;
    const pos = getPosition();
    if (!pos) return;
    const payload = { page: pos.page, offset: pos.offset, zoom, opened };
    recordLocal(paperId, payload);
    sendProgress(paperId, payload, { keepalive });
  }, [cancelPendingSave, recordLocal, sendProgress]);

  const scheduleSave = useCallback((paperId, getPosition, zoom, isCurrentPaper) => {
    if (!paperId) return;
    const pos = getPosition();
    if (!pos) return;
    recordLocal(paperId, { page: pos.page, offset: pos.offset, zoom, opened: true });
    cancelPendingSave();
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      if (isCurrentPaper && !isCurrentPaper(paperId)) return;
      const latest = getPosition();
      if (!latest) return;
      const payload = { page: latest.page, offset: latest.offset, zoom, opened: true };
      recordLocal(paperId, payload);
      sendProgress(paperId, payload);
    }, debounceMs);
  }, [cancelPendingSave, debounceMs, recordLocal, sendProgress]);

  useEffect(() => () => cancelPendingSave(), [cancelPendingSave]);

  return {
    readingState,
    readingStateRef,
    reconcileWithServer,
    recordLocal,
    sendProgress,
    scheduleSave,
    flushSave,
    cancelPendingSave
  };
}
