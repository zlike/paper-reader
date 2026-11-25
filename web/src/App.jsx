import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchPapers } from './lib/api.js';
import { loadPdfjs } from './lib/pdfjs.js';
import {
  normalizeZoom,
  paperIdFromPath,
  paperPath
} from './lib/reading-progress.js';
import { useReadingProgress } from './hooks/useReadingProgress.js';
import { useTextSelection } from './hooks/useTextSelection.js';
import { Header } from './components/Header.jsx';
import { LibraryDrawer } from './components/LibraryDrawer.jsx';
import { PdfReader } from './components/PdfReader.jsx';
import { CitationDialog } from './components/CitationDialog.jsx';

const ADD_PAPER_DIALOG = {
  title: 'Find a paper',
  hint: 'Search for a paper by title or DOI.',
  initialText: '',
  label: 'Paper title or DOI'
};

const CITATION_DIALOG = {
  title: 'Find a cited paper',
  hint: 'Check the text below. For numbered citations, select the full reference from the bibliography instead.',
  label: 'Citation text'
};

function syncHistoryPath(targetPath, history, state) {
  if (window.location.pathname === targetPath) return;
  if (history === 'push') {
    window.history.pushState(state, '', targetPath);
  } else if (history === 'replace') {
    window.history.replaceState(state, '', targetPath);
  }
}

export function App({ pdfjsLoader = loadPdfjs } = {}) {
  const [papers, setPapers] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryStatus, setLibraryStatus] = useState('');
  const [initialPosition, setInitialPosition] = useState(null);
  const [dialogState, setDialogState] = useState({
    open: false,
    ...CITATION_DIALOG,
    initialText: ''
  });

  const papersRef = useRef(papers);
  papersRef.current = papers;
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const pagesContainerRef = useRef(null);
  const readerApiRef = useRef(null);

  const {
    readingState,
    readingStateRef,
    reconcileWithServer,
    recordLocal,
    sendProgress,
    scheduleSave,
    flushSave
  } = useReadingProgress();

  const { selectedText, visible: showFindSelection, dismissSelection } = useTextSelection(pagesContainerRef);

  const currentPaper = useMemo(
    () => papers.find(item => item.id === currentId) || null,
    [papers, currentId]
  );

  useEffect(() => {
    document.title = currentPaper ? `${currentPaper.title} · Paper Reader` : 'Paper Reader';
  }, [currentPaper]);

  const refreshLibrary = useCallback(async () => {
    const data = await fetchPapers();
    const list = data.papers || [];
    papersRef.current = list;
    setPapers(list);
    const validIds = new Set(list.map(paper => paper.id));
    const merged = reconcileWithServer(data.readingState, validIds);
    return { papers: list, readingState: merged };
  }, [reconcileWithServer]);

  const getCurrentPosition = useCallback(
    () => readerApiRef.current?.getCurrentPosition() || null,
    []
  );

  const closePaper = useCallback(() => {
    if (currentIdRef.current && readerApiRef.current?.hasLaidOut()) {
      flushSave(currentIdRef.current, getCurrentPosition, zoomRef.current, { opened: false });
    }
    currentIdRef.current = null;
    setCurrentId(null);
    zoomRef.current = 1;
    setZoom(1);
    setInitialPosition(null);
    dismissSelection();
  }, [dismissSelection, flushSave, getCurrentPosition]);

  const openPaper = useCallback((id, { history = 'push', restore = true } = {}) => {
    const paper = papersRef.current.find(item => item.id === id);
    if (!paper) return;

    const targetPath = paperPath(id);
    if (id === currentIdRef.current) {
      setLibraryOpen(false);
      syncHistoryPath(targetPath, history, { paperId: id });
      return;
    }

    if (currentIdRef.current && readerApiRef.current?.hasLaidOut()) {
      flushSave(currentIdRef.current, getCurrentPosition, zoomRef.current, { opened: false });
    }

    const saved = restore ? readingStateRef.current.positions[id] : null;
    const nextZoom = normalizeZoom(saved?.zoom);
    currentIdRef.current = id;
    zoomRef.current = nextZoom;

    setCurrentId(id);
    setZoom(nextZoom);
    setInitialPosition(saved ? { page: saved.page, offset: saved.offset } : { page: 1, offset: 0 });
    setLibraryStatus('');
    setLibraryOpen(false);
    dismissSelection();

    syncHistoryPath(targetPath, history, { paperId: id });

    const initialPayload = {
      page: saved?.page ?? 1,
      offset: saved?.offset ?? 0,
      zoom: nextZoom,
      opened: true
    };
    recordLocal(id, initialPayload);
    sendProgress(id, initialPayload);
  }, [dismissSelection, flushSave, getCurrentPosition, readingStateRef, recordLocal, sendProgress]);

  const handleReaderScroll = useCallback(() => {
    const activeId = currentIdRef.current;
    if (!activeId) return;
    scheduleSave(activeId, getCurrentPosition, zoomRef.current, id => currentIdRef.current === id);
  }, [getCurrentPosition, scheduleSave]);

  const handleChangeZoom = useCallback(delta => {
    if (!currentIdRef.current) return;
    const previous = zoomRef.current;
    const next = normalizeZoom(previous + delta);
    if (next === previous) return;
    const pos = getCurrentPosition();
    zoomRef.current = next;
    setZoom(next);
    if (pos) {
      const payload = { page: pos.page, offset: pos.offset, zoom: next, opened: true };
      recordLocal(currentIdRef.current, payload);
      sendProgress(currentIdRef.current, payload);
    }
  }, [getCurrentPosition, recordLocal, sendProgress]);

  // Flush reading progress on page hide / tab backgrounding.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && currentIdRef.current && readerApiRef.current?.hasLaidOut()) {
        flushSave(currentIdRef.current, getCurrentPosition, zoomRef.current, { keepalive: true });
      }
    };
    const handlePageHide = () => {
      if (currentIdRef.current && readerApiRef.current?.hasLaidOut()) {
        flushSave(currentIdRef.current, getCurrentPosition, zoomRef.current, { keepalive: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [flushSave, getCurrentPosition]);

  // Handle browser back / forward navigation.
  useEffect(() => {
    const handlePopState = () => {
      const routeId = paperIdFromPath(window.location.pathname);
      if (routeId && papersRef.current.some(paper => paper.id === routeId)) {
        if (routeId !== currentIdRef.current) {
          openPaper(routeId, { history: 'none' });
        }
      } else {
        if (routeId) {
          window.history.replaceState({}, '', '/');
          setLibraryStatus('The requested paper is no longer in your library.');
        }
        closePaper();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [closePaper, openPaper]);

  // Boot: load library, open deep-linked paper or last opened paper.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { papers: loadedPapers, readingState: merged } = await refreshLibrary();
        if (!active) return;
        const routeId = paperIdFromPath(window.location.pathname);
        if (routeId) {
          if (loadedPapers.some(paper => paper.id === routeId)) {
            openPaper(routeId, { history: 'replace' });
          } else {
            window.history.replaceState({}, '', '/');
            setLibraryStatus('The requested paper is no longer in your library.');
            setLibraryOpen(true);
          }
          return;
        }
        const lastId = merged.lastPaperId;
        if (lastId && loadedPapers.some(paper => paper.id === lastId)) {
          openPaper(lastId, { history: 'replace' });
        } else {
          setLibraryOpen(true);
        }
      } catch (error) {
        if (active) setLibraryStatus(error.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [openPaper, refreshLibrary]);

  const handleToggleLibrary = useCallback(() => {
    setLibraryOpen(prev => !prev);
  }, []);

  const handleCloseLibrary = useCallback(() => {
    setLibraryOpen(false);
  }, []);

  const handleAddPaper = useCallback(() => {
    setLibraryOpen(false);
    setDialogState({
      open: true,
      ...ADD_PAPER_DIALOG
    });
  }, []);

  const handleFindSelection = useCallback(() => {
    dismissSelection();
    setDialogState({
      open: true,
      ...CITATION_DIALOG,
      initialText: selectedText
    });
  }, [dismissSelection, selectedText]);

  const handleCloseDialog = useCallback(() => {
    setDialogState(prev => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  return (
    <>
      <Header
        libraryOpen={libraryOpen}
        onToggleLibrary={handleToggleLibrary}
        currentTitle={currentPaper?.title}
        showZoom={Boolean(currentId)}
        zoom={zoom}
        onZoomOut={() => handleChangeZoom(-0.25)}
        onZoomIn={() => handleChangeZoom(0.25)}
      />
      <div className="layout">
        <LibraryDrawer
          open={libraryOpen}
          dialogOpen={dialogState.open}
          papers={papers}
          positions={readingState.positions}
          currentId={currentId}
          statusMessage={libraryStatus}
          onClose={handleCloseLibrary}
          onSelectPaper={id => openPaper(id)}
          onAddPaper={handleAddPaper}
        />
        <PdfReader
          paperId={currentId}
          zoom={zoom}
          initialPosition={initialPosition}
          onScroll={handleReaderScroll}
          pagesContainerRef={pagesContainerRef}
          readerApiRef={readerApiRef}
          pdfjsLoader={pdfjsLoader}
        />
      </div>
      <button
        id="find-selection"
        type="button"
        hidden={!showFindSelection}
        onClick={handleFindSelection}
      >
        Find cited paper
      </button>
      <CitationDialog
        open={dialogState.open}
        title={dialogState.title}
        hint={dialogState.hint}
        initialText={dialogState.initialText}
        label={dialogState.label}
        onClose={handleCloseDialog}
        onPaperAdded={refreshLibrary}
        onOpenPaper={id => openPaper(id)}
      />
    </>
  );
}
