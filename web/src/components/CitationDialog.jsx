import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { downloadCitation, searchCitations } from '../lib/api.js';

function candidateKey(candidate) {
  return `${candidate.source}:${candidate.id}`;
}

const DEFAULT_PROVIDERS = [
  { id: 'OPENALEX', name: 'OpenAlex' },
  { id: 'ARXIV', name: 'arXiv' },
  { id: 'CROSSREF', name: 'Crossref' }
];

const SOURCE_LABELS = {
  OPENALEX: 'OpenAlex',
  ARXIV: 'arXiv',
  CROSSREF: 'Crossref',
  SEMANTIC_SCHOLAR: 'Semantic Scholar'
};

export function CitationDialog({
  open,
  title,
  hint,
  initialText,
  label,
  autoSearch = false,
  onClose,
  onPaperAdded,
  onOpenPaper
}) {
  const dialogRef = useRef(null);
  const textareaRef = useRef(null);
  const sessionRef = useRef(0);
  const runSearchRef = useRef(null);

  const [text, setText] = useState(initialText || '');
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState('');
  const [providers, setProviders] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [itemStates, setItemStates] = useState({});

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

  const runSearch = useCallback(async (queryText, session) => {
    setCandidates([]);
    setProviders([]);
    setItemStates({});
    setStatus('Searching papers…');
    setSearching(true);
    try {
      const result = await searchCitations(queryText);
      if (session !== sessionRef.current) return;
      if (Array.isArray(result.providers)) setProviders(result.providers);
      if (!result.candidates.length) {
        setStatus('No matches found. Try the full title or DOI.');
        return;
      }
      const initialStates = {};
      for (const candidate of result.candidates) {
        if (candidate.existingPaperId) {
          initialStates[candidateKey(candidate)] = {
            status: 'ready',
            paperId: candidate.existingPaperId,
            existing: true
          };
        }
      }
      setItemStates(initialStates);
      setCandidates(result.candidates);
      if (result.confident?.existingPaperId) {
        setStatus('This paper is already in your library.');
      } else if (result.confident?.hasPdf) {
        setStatus('Exact match found.');
      } else if (result.confident) {
        setStatus('Exact match found, but no open-access PDF is listed.');
      } else {
        setStatus('Choose the correct paper from these possible matches.');
      }
    } catch (error) {
      if (session === sessionRef.current) setStatus(error.message);
    } finally {
      if (session === sessionRef.current) setSearching(false);
    }
  }, []);

  runSearchRef.current = runSearch;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      const session = sessionRef.current + 1;
      sessionRef.current = session;
      const nextText = initialText || '';
      setText(nextText);
      setSearching(false);
      setStatus('');
      setProviders([]);
      setCandidates([]);
      setItemStates({});
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
      textareaRef.current?.focus();
      if (autoSearch && nextText.trim()) {
        runSearchRef.current?.(nextText, session);
      }
    } else {
      sessionRef.current += 1;
      setText('');
      if (dialog.open && typeof dialog.close === 'function') {
        dialog.close();
      }
    }
  }, [open, initialText, title, hint, label, autoSearch]);

  const handleSearch = useCallback(async () => {
    await runSearch(text, sessionRef.current);
  }, [text, runSearch]);

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
      {(searching || providers.length > 0) && (
        <div className="provider-indicators" aria-label="Search providers">
          {(searching ? DEFAULT_PROVIDERS : providers).map(provider => {
            const stateClass = searching
              ? 'is-searching'
              : provider.status === 'ok'
                ? 'is-ok'
                : provider.status === 'error'
                  ? 'is-error'
                  : 'is-empty';
            const detailText = searching
              ? 'Searching…'
              : provider.status === 'ok'
                ? `${provider.count} ${provider.count === 1 ? 'match' : 'matches'}`
                : provider.status === 'error'
                  ? (provider.error || 'Search failed')
                  : (provider.reason || 'No matches');
            const badgeText = searching
              ? null
              : provider.status === 'ok'
                ? String(provider.count)
                : provider.status === 'error'
                  ? 'Error'
                  : '0';
            return (
              <span
                key={provider.id}
                className={`provider-pill ${stateClass}`}
                title={`${provider.name}: ${detailText}`}
              >
                <span className="provider-dot" aria-hidden="true" />
                <span>{provider.name}</span>
                {badgeText !== null && (
                  <span className="provider-count">{badgeText}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
      {!searching && providers.some(provider => provider.status === 'error') && (
        <ul className="provider-errors" aria-label="Provider errors">
          {providers
            .filter(provider => provider.status === 'error')
            .map(provider => (
              <li key={provider.id}>
                <strong>{provider.name}:</strong> {provider.error || 'Search failed'}
              </li>
            ))}
        </ul>
      )}
      <div id="results">
        {candidates.map(candidate => {
          const key = candidateKey(candidate);
          const itemState = itemStates[key];
          const sourceLabel = SOURCE_LABELS[candidate.source];
          const details = [
            sourceLabel,
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
