import { useEffect, useMemo } from 'react';
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
  onAddPaper
}) {
  useEffect(() => {
    if (!open) return undefined;
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
                  section.items.map(({ paper, timestamp }) => (
                    <button
                      key={paper.id}
                      type="button"
                      className={`paper${paper.id === currentId ? ' active' : ''}`}
                      title={paper.title}
                      onClick={() => onSelectPaper(paper.id)}
                    >
                      <span className="paper-title">{paper.title}</span>
                      <span className="paper-time">{formatPaperTimestamp(timestamp, now)}</span>
                    </button>
                  ))
                )}
              </div>
            ))
          )}
        </nav>
      </aside>
    </>
  );
}
