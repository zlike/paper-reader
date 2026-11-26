import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadCitation, searchCitations } from '../lib/api.js';

function candidateKey(candidate) {
  return `${candidate.source}:${candidate.id}`;
}

export function CitationDialog({
  open,
  title,
  hint,
  initialText,
  label,
  onClose,
  onPaperAdded,
  onOpenPaper
}) {
  const dialogRef = useRef(null);
  const textareaRef = useRef(null);
  const sessionRef = useRef(0);

  const [text, setText] = useState(initialText || '');
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [itemStates, setItemStates] = useState({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      sessionRef.current += 1;
      setText(initialText || '');
      setSearching(false);
      setStatus('');
      setCandidates([]);
      setItemStates({});
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
      textareaRef.current?.focus();
    } else {
      sessionRef.current += 1;
      if (dialog.open && typeof dialog.close === 'function') {
        dialog.close();
      }
    }
  }, [open, initialText, title, hint, label]);

  const handleNativeClose = useCallback(() => {
    sessionRef.current += 1;
    onClose();
  }, [onClose]);

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

  const handleDownload = useCallback(async (candidate, session) => {
    const key = candidateKey(candidate);
    setItemStates(prev => ({
      ...prev,
      [key]: { status: 'downloading' }
    }));
    try {
      const result = await downloadCitation(candidate.source, candidate.id);
      await onPaperAdded();
      if (session !== sessionRef.current) return;
      setItemStates(prev => ({
        ...prev,
        [key]: {
          status: 'ready',
          paperId: result.paper.id,
          existing: Boolean(result.existing)
        }
      }));
      setStatus(result.existing ? 'This paper is already in your library.' : 'PDF added to your library.');
    } catch (error) {
      if (session !== sessionRef.current) return;
      setStatus(error.message);
      setItemStates(prev => ({
        ...prev,
        [key]: { status: 'error' }
      }));
    }
  }, [onPaperAdded]);

  const handleSearch = useCallback(async () => {
    const session = sessionRef.current;
    setCandidates([]);
    setItemStates({});
    setStatus('Searching OpenAlex…');
    setSearching(true);
    try {
      const result = await searchCitations(text);
      if (session !== sessionRef.current) return;
      if (!result.candidates.length) {
        setStatus('No matches found. Try the full title or DOI.');
        return;
      }
      setStatus(result.confident
        ? 'Exact DOI match found.'
        : 'Choose the correct paper from these possible matches.');
      setCandidates(result.candidates);
      if (result.confident?.hasPdf) {
        await handleDownload(result.confident, session);
      } else if (result.confident) {
        setStatus('Exact match found, but no open-access PDF is listed.');
      }
    } catch (error) {
      if (session === sessionRef.current) setStatus(error.message);
    } finally {
      if (session === sessionRef.current) setSearching(false);
    }
  }, [text, handleDownload]);

  return (
    <dialog
      ref={dialogRef}
      id="citation-dialog"
      aria-labelledby="dialog-title"
    >
      <div className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button
          id="close-dialog"
          type="button"
          className="icon"
          aria-label="Close"
          onClick={closeDialog}
        >
          ✕
        </button>
      </div>
      <p id="dialog-hint" className="hint">{hint}</p>
      <textarea
        ref={textareaRef}
        id="citation-text"
        rows={4}
        maxLength={4000}
        aria-label={label}
        placeholder={label}
        value={text}
        onChange={event => setText(event.target.value)}
      />
      <button
        id="search-citation"
        type="button"
        className="primary"
        disabled={searching}
        onClick={handleSearch}
      >
        Search
      </button>
      <div id="search-status" role="status">{status}</div>
      <div id="results">
        {candidates.map(candidate => {
          const key = candidateKey(candidate);
          const itemState = itemStates[key];
          const details = [
            candidate.authors,
            candidate.year,
            candidate.doi && `DOI: ${candidate.doi}`
          ].filter(Boolean).join(' · ');

          let buttonText = candidate.hasPdf ? 'Download PDF' : 'No open-access PDF listed';
          let buttonDisabled = !candidate.hasPdf;
          let onClick = () => handleDownload(candidate, sessionRef.current);

          if (itemState?.status === 'downloading') {
            buttonText = 'Downloading…';
            buttonDisabled = true;
          } else if (itemState?.status === 'ready') {
            buttonText = itemState.existing ? 'Open existing paper' : 'Open paper';
            buttonDisabled = false;
            onClick = () => {
              closeDialog();
              onOpenPaper(itemState.paperId);
            };
          } else if (itemState?.status === 'error') {
            buttonText = 'Retry download';
            buttonDisabled = false;
          }

          return (
            <div key={key} className="result">
              <strong>{candidate.title}</strong>
              <p className="hint">{details}</p>
              <button
                type="button"
                disabled={buttonDisabled}
                onClick={onClick}
              >
                {buttonText}
              </button>
            </div>
          );
        })}
      </div>
    </dialog>
  );
}
