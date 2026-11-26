import { useEffect, useMemo, useState } from 'react';
import { categorizePapers, formatPaperTimestamp } from '../lib/reading-progress.js';
import { useSwipeToClose } from '../hooks/useSwipeToClose.js';

export function LibraryDrawer({
  open,
  dialogOpen,
  papers,
  positions,
  currentId,
  statusMessage,
  onClose,
  onSelectPaper,
  onDeletePaper,
  onAddPaper
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (!open) {
      setConfirmDeleteId(null);
      return undefined;
    }
    const handleKeyDown = event => {
      if (event.key === 'Escape' && !dialogOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, dialogOpen, onClose]);

  const { offsetX, isSwiping, handlers } = useSwipeToClose({
    enabled: open,
    onClose
  });

  const sections = useMemo(() => {
    const { unread, read } = categorizePapers(papers, positions);
    return [
      { key: 'unread', heading: 'Unread', emptyText: 'No unread papers.', items: unread },
      { key: 'read', heading: 'Read', emptyText: 'No read papers yet.', items: read }
    ];
  }, [papers, positions]);

  const handleConfirmDelete = async id => {
    if (!onDeletePaper || deletingId) return;
    setDeletingId(id);
    try {
      await onDeletePaper(id);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const now = new Date();
  const asideStyle = isSwiping ? { transform: `translateX(${offsetX}px)` } : undefined;

  return (
    <>
      <div
        id="library-backdrop"
        hidden={!open}
        onClick={onClose}
      />
      <aside
        id="library"
        aria-label="Paper library"
        className={`${open ? 'open' : ''}${isSwiping ? ' swiping' : ''}`.trim()}
        style={asideStyle}
        {...handlers}
      >
        <div className="library-heading">
          <h1>Library</h1>
          <button
            id="add-paper"
            type="button"
            className="primary"
            onClick={onAddPaper}
          >
            + Add PDF
          </button>
        </div>
        <p className="hint">Select text in a paper to find a cited paper.</p>
        <div id="library-status" role="status">{statusMessage}</div>
        <nav id="paper-list" aria-label="Papers">
          {!papers.length ? (
            'No papers yet.'
          ) : (
            sections.map(section => (
              <div key={section.key} className="paper-section">
                <h2 className="paper-section-title">{section.heading}</h2>
                {!section.items.length ? (
                  <p className="paper-section-empty">{section.emptyText}</p>
                ) : (
                  section.items.map(({ paper, timestamp }) => {
                    const isConfirming = confirmDeleteId === paper.id;
                    const isDeleting = deletingId === paper.id;
                    return (
                      <div key={paper.id} className="paper-row">
                        <button
                          type="button"
                          className={`paper${paper.id === currentId ? ' active' : ''}`}
                          title={paper.title}
                          onClick={() => onSelectPaper(paper.id)}
                        >
                          <span className="paper-title">{paper.title}</span>
                          <span className="paper-time">{formatPaperTimestamp(timestamp, now)}</span>
                        </button>
                        {onDeletePaper && (
                          isConfirming ? (
                            <div className="paper-delete-actions" role="group" aria-label={`Confirm delete ${paper.title}`}>
                              <button
                                type="button"
                                className="paper-delete-confirm"
                                disabled={isDeleting}
                                onClick={() => handleConfirmDelete(paper.id)}
                              >
                                {isDeleting ? 'Deleting…' : 'Delete'}
                              </button>
                              <button
                                type="button"
                                className="paper-delete-cancel"
                                disabled={isDeleting}
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="paper-delete"
                              aria-label={`Delete ${paper.title}`}
                              title="Delete paper"
                              disabled={Boolean(deletingId)}
                              onClick={() => setConfirmDeleteId(paper.id)}
                            >
                              ✕
                            </button>
                          )
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ))
          )}
        </nav>
      </aside>
    </>
  );
}
