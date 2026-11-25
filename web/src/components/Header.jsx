export function Header({
  libraryOpen,
  onToggleLibrary,
  currentTitle,
  showZoom,
  zoom,
  onZoomOut,
  onZoomIn
}) {
  return (
    <header>
      <button
        id="library-toggle"
        type="button"
        className="icon"
        aria-label={libraryOpen ? 'Hide library' : 'Show library'}
        aria-expanded={libraryOpen}
        aria-controls="library"
        onClick={onToggleLibrary}
      >
        ☰
      </button>
      <strong>Paper Reader</strong>
      <span id="current-title">{currentTitle || 'Your research library'}</span>
      <div id="zoom-controls" hidden={!showZoom}>
        <button
          id="zoom-out"
          type="button"
          className="icon"
          aria-label="Zoom out"
          onClick={onZoomOut}
        >
          −
        </button>
        <span id="zoom-level">{`${Math.round(zoom * 100)}%`}</span>
        <button
          id="zoom-in"
          type="button"
          className="icon"
          aria-label="Zoom in"
          onClick={onZoomIn}
        >
          +
        </button>
      </div>
    </header>
  );
}
