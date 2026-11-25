import * as pdfjs from '/vendor/pdfjs/build/pdf.mjs';
import { destinationPosition, isSupportedLink, resolveDestination } from './pdf-links.js';
import {
  categorizePapers,
  computeReadingPosition,
  computeScrollTop,
  formatPaperTimestamp,
  loadLocalReadingState,
  mergeReadingStates,
  normalizeZoom,
  paperIdFromPath,
  paperPath,
  saveLocalReadingState
} from './reading-progress.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.mjs';

const $ = selector => document.querySelector(selector);
const library = $('#library');
const libraryBackdrop = $('#library-backdrop');
const reader = $('#reader');
const pages = $('#pages');
const dialog = $('#citation-dialog');
const defaultEmptyHtml = $('#empty').innerHTML;
let papers = [];
let readingState = loadLocalReadingState();
let currentId = null;
let loadingPaperId = null;
let pdf = null;
let observer = null;
let generation = 0;
let layoutVersion = 0;
let zoom = 1;
let selectedText = '';
let dialogSession = 0;
let layoutReady = Promise.resolve();
let hasLaidOutCurrentPaper = false;
let isRestoringPosition = false;
let progressSaveTimer = null;
let lastSentKey = '';

async function api(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function getPageMetrics() {
  const readerRect = reader.getBoundingClientRect();
  return Array.from(pages.querySelectorAll('.page'), element => ({
    page: Number(element.dataset.page),
    top: element.getBoundingClientRect().top - readerRect.top + reader.scrollTop,
    height: element.clientHeight
  }));
}

function getCurrentPosition() {
  return computeReadingPosition(getPageMetrics(), reader.scrollTop);
}

function recordLocalProgress(paperId, { page, offset, zoom: nextZoom, opened = true }) {
  const now = new Date().toISOString();
  const existing = readingState.positions[paperId];
  const entry = {
    page,
    offset,
    zoom: nextZoom,
    last_opened_at: opened === false && existing?.last_opened_at ? existing.last_opened_at : now,
    updated_at: now
  };
  readingState = {
    lastPaperId: opened === false ? (readingState.lastPaperId ?? paperId) : paperId,
    positions: { ...readingState.positions, [paperId]: entry }
  };
  saveLocalReadingState(readingState);
  return entry;
}

function sendProgressToServer(paperId, payload, { keepalive = false } = {}) {
  const key = `${paperId}:${payload.page}:${payload.offset}:${payload.zoom}:${payload.opened !== false}`;
  if (!keepalive && key === lastSentKey) return;
  lastSentKey = key;
  const url = `/api/papers/${encodeURIComponent(paperId)}/progress`;
  const body = JSON.stringify(payload);
  if (keepalive && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      if (navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
    } catch {
      // Fall through to keepalive fetch.
    }
  }
  fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive
  }).catch(() => {});
}

function flushReadingProgress({ keepalive = false, opened = true } = {}) {
  clearTimeout(progressSaveTimer);
  progressSaveTimer = null;
  if (!currentId || !hasLaidOutCurrentPaper) return;
  const pos = getCurrentPosition();
  if (!pos) return;
  const payload = { page: pos.page, offset: pos.offset, zoom, opened };
  recordLocalProgress(currentId, payload);
  sendProgressToServer(currentId, payload, { keepalive });
}

function scheduleReadingProgressSave() {
  if (!currentId || !hasLaidOutCurrentPaper || isRestoringPosition) return;
  const pos = getCurrentPosition();
  if (!pos) return;
  recordLocalProgress(currentId, { page: pos.page, offset: pos.offset, zoom, opened: true });
  clearTimeout(progressSaveTimer);
  const targetId = currentId;
  progressSaveTimer = setTimeout(() => {
    progressSaveTimer = null;
    if (currentId !== targetId || !hasLaidOutCurrentPaper) return;
    const latest = getCurrentPosition();
    if (!latest) return;
    const payload = { page: latest.page, offset: latest.offset, zoom, opened: true };
    recordLocalProgress(targetId, payload);
    sendProgressToServer(targetId, payload);
  }, 400);
}

function showLibrary(open) {
  library.classList.toggle('open', open);
  libraryBackdrop.hidden = !open;
  $('#library-toggle').setAttribute('aria-expanded', String(open));
  $('#library-toggle').setAttribute('aria-label', open ? 'Hide library' : 'Show library');
  if (open && papers.length) renderLibraryList();
}

$('#library-toggle').addEventListener('click', () => showLibrary(!library.classList.contains('open')));
libraryBackdrop.addEventListener('click', () => showLibrary(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && library.classList.contains('open') && !dialog.open) {
    showLibrary(false);
  }
});
showLibrary(false);

function renderLibraryList() {
  const list = $('#paper-list');
  list.replaceChildren();
  if (!papers.length) {
    list.textContent = 'No papers yet.';
    return;
  }
  const { unread, read } = categorizePapers(papers, readingState.positions);
  const now = new Date();
  const sections = [
    { heading: 'Unread', emptyText: 'No unread papers.', items: unread },
    { heading: 'Read', emptyText: 'No read papers yet.', items: read }
  ];
  for (const section of sections) {
    const group = document.createElement('div');
    group.className = 'paper-section';
    const heading = document.createElement('h2');
    heading.className = 'paper-section-title';
    heading.textContent = section.heading;
    group.append(heading);
    if (!section.items.length) {
      const empty = document.createElement('p');
      empty.className = 'paper-section-empty';
      empty.textContent = section.emptyText;
      group.append(empty);
    } else {
      for (const { paper, timestamp } of section.items) {
        const button = document.createElement('button');
        button.className = `paper${paper.id === currentId ? ' active' : ''}`;
        button.title = paper.title;
        const titleEl = document.createElement('span');
        titleEl.className = 'paper-title';
        titleEl.textContent = paper.title;
        const timeEl = document.createElement('span');
        timeEl.className = 'paper-time';
        timeEl.textContent = formatPaperTimestamp(timestamp, now);
        button.append(titleEl, timeEl);
        button.addEventListener('click', () => openPaper(paper.id));
        group.append(button);
      }
    }
    list.append(group);
  }
}

async function refreshLibrary() {
  const data = await api('/api/papers');
  papers = data.papers;
  const validIds = new Set(papers.map(paper => paper.id));
  readingState = mergeReadingStates(data.readingState, loadLocalReadingState(), validIds);
  saveLocalReadingState(readingState);
  renderLibraryList();
}

$('#add-paper').addEventListener('click', () => {
  showLibrary(false);
  openSearchDialog({ title: 'Find a paper', hint: 'Search for a paper by title or DOI.', text: '', label: 'Paper title or DOI' });
});

function closePaper({ history = 'none' } = {}) {
  flushReadingProgress({ opened: false });
  generation++;
  observer?.disconnect();
  if (pdf) {
    pdf.destroy();
    pdf = null;
  }
  currentId = null;
  loadingPaperId = null;
  hasLaidOutCurrentPaper = false;
  zoom = 1;
  $('#zoom-level').textContent = '100%';
  $('#zoom-controls').hidden = true;
  $('#current-title').textContent = 'Your research library';
  document.title = 'Paper Reader';
  $('#empty').innerHTML = defaultEmptyHtml;
  $('#empty').hidden = false;
  pages.replaceChildren();
  $('#find-selection').hidden = true;
  $('#reader-status').hidden = true;
  if (history === 'push' && window.location.pathname !== '/') {
    window.history.pushState({}, '', '/');
  } else if (history === 'replace' && window.location.pathname !== '/') {
    window.history.replaceState({}, '', '/');
  }
  renderLibraryList();
}

async function openPaper(id, { history = 'push', restore = true } = {}) {
  const paper = papers.find(item => item.id === id);
  if (!paper) return;
  if (id === currentId && (pdf || loadingPaperId === id)) {
    showLibrary(false);
    const targetPath = paperPath(id);
    if (history === 'push' && window.location.pathname !== targetPath) {
      window.history.pushState({ paperId: id }, '', targetPath);
    } else if (history === 'replace' && window.location.pathname !== targetPath) {
      window.history.replaceState({ paperId: id }, '', targetPath);
    }
    return;
  }
  if (currentId && currentId !== id) {
    flushReadingProgress({ opened: false });
  }
  const thisGeneration = ++generation;
  observer?.disconnect();
  if (pdf) {
    pdf.destroy();
    pdf = null;
  }
  const saved = restore ? readingState.positions[id] : null;
  currentId = id;
  loadingPaperId = id;
  hasLaidOutCurrentPaper = false;
  zoom = normalizeZoom(saved?.zoom);
  $('#zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  $('#zoom-controls').hidden = false;
  $('#current-title').textContent = paper.title;
  document.title = `${paper.title} · Paper Reader`;
  $('#empty').hidden = true;
  pages.replaceChildren();
  $('#find-selection').hidden = true;
  $('#reader-status').hidden = true;
  $('#library-status').textContent = '';
  showLibrary(false);
  const targetPath = paperPath(id);
  if (history === 'push' && window.location.pathname !== targetPath) {
    window.history.pushState({ paperId: id }, '', targetPath);
  } else if (history === 'replace' && window.location.pathname !== targetPath) {
    window.history.replaceState({ paperId: id }, '', targetPath);
  }
  const initialPayload = {
    page: saved?.page ?? 1,
    offset: saved?.offset ?? 0,
    zoom,
    opened: true
  };
  recordLocalProgress(id, initialPayload);
  renderLibraryList();
  sendProgressToServer(id, initialPayload);
  try {
    const loadingTask = pdfjs.getDocument(`/api/papers/${encodeURIComponent(id)}/file`);
    const document = await loadingTask.promise;
    if (generation !== thisGeneration) {
      await document.destroy();
      return;
    }
    pdf = document;
    isRestoringPosition = true;
    await layoutPages(document, thisGeneration);
    if (generation !== thisGeneration) {
      isRestoringPosition = false;
      return;
    }
    reader.scrollTop = saved ? computeScrollTop(getPageMetrics(), saved) : 0;
    hasLaidOutCurrentPaper = true;
    requestAnimationFrame(() => { isRestoringPosition = false; });
  } catch (error) {
    isRestoringPosition = false;
    if (generation === thisGeneration) {
      $('#empty').hidden = false;
      $('#empty').textContent = `Unable to open PDF: ${error.message}`;
    }
  } finally {
    if (generation === thisGeneration) loadingPaperId = null;
  }
}

function layoutPages(document, thisGeneration) {
  layoutReady = buildPageLayout(document, thisGeneration);
  return layoutReady;
}

async function buildPageLayout(document, thisGeneration) {
  const thisLayout = ++layoutVersion;
  observer?.disconnect();
  pages.replaceChildren();
  const width = Math.max(220, Math.min(reader.clientWidth - 16, 1100)) * zoom;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const element = entry.target;
      if (entry.isIntersecting && !element.dataset.rendering && !element.dataset.rendered) {
        element.dataset.rendering = 'true';
        renderPage(element, document, width, thisGeneration).catch(error => {
          if (generation === thisGeneration) element.textContent = `Unable to render page: ${error.message}`;
        }).finally(() => { delete element.dataset.rendering; });
      } else if (!entry.isIntersecting && element.dataset.rendered) {
        element.replaceChildren();
        delete element.dataset.rendered;
      }
    }
  }, { root: reader, rootMargin: '100% 0px' });
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    if (generation !== thisGeneration || layoutVersion !== thisLayout) return;
    const base = page.getViewport({ scale: 1 });
    const element = window.document.createElement('div');
    element.className = 'page';
    element.dataset.page = number;
    element.style.width = `${width}px`;
    element.style.height = `${width * base.height / base.width}px`;
    element.setAttribute('aria-label', `Page ${number}`);
    pages.append(element);
    observer.observe(element);
  }
}

async function changeZoom(delta) {
  if (!pdf) return;
  const previous = zoom;
  zoom = normalizeZoom(zoom + delta);
  if (zoom === previous) return;
  const thisGeneration = generation;
  const pos = getCurrentPosition();
  $('#zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  try {
    isRestoringPosition = true;
    await layoutPages(pdf, thisGeneration);
    if (generation !== thisGeneration) {
      isRestoringPosition = false;
      return;
    }
    reader.scrollTop = pos ? computeScrollTop(getPageMetrics(), pos) : 0;
    const nextPos = pos || getCurrentPosition();
    if (nextPos && currentId) {
      const payload = { page: nextPos.page, offset: nextPos.offset, zoom, opened: true };
      recordLocalProgress(currentId, payload);
      sendProgressToServer(currentId, payload);
    }
    requestAnimationFrame(() => { isRestoringPosition = false; });
  } catch (error) {
    isRestoringPosition = false;
    $('#library-status').textContent = error.message;
  }
}
$('#zoom-in').addEventListener('click', () => changeZoom(.25));
$('#zoom-out').addEventListener('click', () => changeZoom(-.25));

async function renderPage(element, document, width, thisGeneration) {
  const page = await document.getPage(Number(element.dataset.page));
  if (generation !== thisGeneration || !element.isConnected) return;
  const scale = width / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  const text = window.document.createElement('div');
  text.className = 'textLayer';
  text.style.setProperty('--scale-factor', scale);
  const annotations = window.document.createElement('div');
  annotations.className = 'annotationLayer';
  annotations.style.setProperty('--scale-factor', scale);
  element.replaceChildren(canvas, text, annotations);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] }).promise;
  if (generation !== thisGeneration || !element.isConnected) return;
  await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
  const links = (await page.getAnnotations()).filter(isSupportedLink);
  if (generation !== thisGeneration || !element.isConnected) return;
  const linkService = {
    addLinkAttributes(link, url) {
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    },
    getDestinationHash: () => '#',
    getAnchorUrl: () => '#',
    goToDestination: destination => {
      navigateToDestination(document, destination, thisGeneration).catch(error => {
        if (generation === thisGeneration) showReaderError(error);
      });
    },
    executeNamedAction: action => {
      const current = Number(element.dataset.page);
      const target = { FirstPage: 1, LastPage: document.numPages, NextPage: current + 1, PrevPage: current - 1 }[action];
      if (target >= 1 && target <= document.numPages) {
        navigateToDestination(document, [target - 1, { name: 'Fit' }], thisGeneration).catch(error => {
          if (generation === thisGeneration) showReaderError(error);
        });
      }
    }
  };
  await new pdfjs.AnnotationLayer({ div: annotations, page, viewport: viewport.clone({ dontFlip: true }) })
    .render({ annotations: links, linkService });
  for (const link of annotations.querySelectorAll('.linkAnnotation > a')) {
    link.setAttribute('aria-label', link.target === '_blank' ? 'Open external link in a new tab' : 'Go to link in this paper');
  }
  element.dataset.rendered = 'true';
}

function showReaderError(error) {
  $('#reader-status').textContent = `Unable to follow PDF link: ${error.message}`;
  $('#reader-status').hidden = false;
}

async function navigateToDestination(document, destination, thisGeneration) {
  const resolved = await resolveDestination(document, destination);
  const page = await document.getPage(resolved.pageNumber);
  let layout;
  do {
    layout = layoutReady;
    await layout;
  } while (layout !== layoutReady);
  if (generation !== thisGeneration || pdf !== document) return;
  const element = pages.querySelector(`[data-page="${resolved.pageNumber}"]`);
  if (!element) throw new Error('Destination page is unavailable.');
  const scale = element.clientWidth / page.getViewport({ scale: 1 }).width;
  const point = destinationPosition(page, page.getViewport({ scale }), resolved.destination);
  const pageRect = element.getBoundingClientRect();
  const readerRect = reader.getBoundingClientRect();
  $('#reader-status').hidden = true;
  reader.scrollTop += pageRect.top - readerRect.top + point.y;
  reader.scrollLeft += pageRect.left - readerRect.left + point.x;
}

pages.addEventListener('click', event => {
  if (event.target.closest('.annotationLayer') || !window.getSelection()?.isCollapsed) return;
  const page = event.target.closest('.page');
  if (!page) return;
  // Hit-test links after selection so link overlays never block selecting PDF text.
  for (const link of page.querySelectorAll('.linkAnnotation > a')) {
    const rect = link.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom) {
      link.click();
      break;
    }
  }
});

let resizeTimer;
let readerWidth = reader.clientWidth;
new ResizeObserver(() => {
  if (reader.clientWidth === readerWidth) return;
  readerWidth = reader.clientWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!pdf) return;
    const document = pdf;
    const currentGeneration = generation;
    const pos = getCurrentPosition();
    const nextLayout = layoutVersion + 1;
    isRestoringPosition = true;
    layoutPages(document, currentGeneration).then(() => {
      if (pdf === document && generation === currentGeneration && layoutVersion === nextLayout) {
        reader.scrollTop = pos ? computeScrollTop(getPageMetrics(), pos) : 0;
      }
      requestAnimationFrame(() => { isRestoringPosition = false; });
    }).catch(error => {
      isRestoringPosition = false;
      $('#library-status').textContent = error.message;
    });
  }, 300);
}).observe(reader);

reader.addEventListener('scroll', scheduleReadingProgressSave, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushReadingProgress({ keepalive: true });
});
window.addEventListener('pagehide', () => flushReadingProgress({ keepalive: true }));

window.addEventListener('popstate', () => {
  const routeId = paperIdFromPath(window.location.pathname);
  if (routeId && papers.some(paper => paper.id === routeId)) {
    if (routeId !== currentId) openPaper(routeId, { history: 'none' });
  } else {
    if (routeId) {
      window.history.replaceState({}, '', '/');
      $('#library-status').textContent = 'The requested paper is no longer in your library.';
    }
    closePaper({ history: 'none' });
  }
});

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (text && selection.anchorNode && pages.contains(selection.anchorNode)) {
    selectedText = text;
    $('#find-selection').hidden = false;
  }
});

function openSearchDialog({ title, hint, text, label }) {
  dialogSession++;
  $('#dialog-title').textContent = title;
  $('#dialog-hint').textContent = hint;
  $('#citation-text').value = text;
  $('#citation-text').setAttribute('aria-label', label);
  $('#citation-text').placeholder = label;
  $('#search-status').textContent = '';
  $('#results').replaceChildren();
  $('#search-citation').disabled = false;
  dialog.showModal();
  $('#citation-text').focus();
}

$('#find-selection').addEventListener('click', () => {
  $('#find-selection').hidden = true;
  openSearchDialog({
    title: 'Find a cited paper',
    hint: 'Check the text below. For numbered citations, select the full reference from the bibliography instead.',
    text: selectedText,
    label: 'Citation text'
  });
});
$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { dialogSession++; });

function createResult(candidate, session) {
  const container = document.createElement('div');
  container.className = 'result';
  const title = document.createElement('strong');
  title.textContent = candidate.title;
  const details = document.createElement('p');
  details.className = 'hint';
  details.textContent = [candidate.authors, candidate.year, candidate.doi && `DOI: ${candidate.doi}`].filter(Boolean).join(' · ');
  const button = document.createElement('button');
  button.textContent = candidate.hasPdf ? 'Download PDF' : 'No open-access PDF listed';
  button.disabled = !candidate.hasPdf;
  button.addEventListener('click', () => downloadCandidate(candidate, button, session));
  container.append(title, details, button);
  return { container, button };
}

async function downloadCandidate(candidate, button, session) {
  button.disabled = true;
  button.textContent = 'Downloading…';
  try {
    const result = await api('/api/citations/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: candidate.source, id: candidate.id })
    });
    await refreshLibrary();
    if (session !== dialogSession) return;
    button.textContent = result.existing ? 'Open existing paper' : 'Open paper';
    button.disabled = false;
    button.onclick = () => {
      dialog.close();
      openPaper(result.paper.id);
    };
    // Replace the download listener so opening never triggers another download.
    const openButton = button.cloneNode(true);
    button.replaceWith(openButton);
    openButton.addEventListener('click', button.onclick);
    $('#search-status').textContent = result.existing ? 'This paper is already in your library.' : 'PDF added to your library.';
  } catch (error) {
    if (session !== dialogSession) return;
    $('#search-status').textContent = error.message;
    button.textContent = 'Retry download';
    button.disabled = false;
  }
}

$('#search-citation').addEventListener('click', async () => {
  const session = dialogSession;
  const searchButton = $('#search-citation');
  const results = $('#results');
  results.replaceChildren();
  $('#search-status').textContent = 'Searching OpenAlex…';
  searchButton.disabled = true;
  try {
    const result = await api('/api/citations/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: $('#citation-text').value })
    });
    if (session !== dialogSession) return;
    if (!result.candidates.length) {
      $('#search-status').textContent = 'No matches found. Try the full title or DOI.';
      return;
    }
    $('#search-status').textContent = result.confident
      ? 'Exact DOI match found.' : 'Choose the correct paper from these possible matches.';
    const rendered = new Map();
    for (const candidate of result.candidates) {
      const item = createResult(candidate, session);
      rendered.set(`${candidate.source}:${candidate.id}`, item);
      results.append(item.container);
    }
    if (result.confident?.hasPdf) {
      await downloadCandidate(result.confident, rendered.get(`${result.confident.source}:${result.confident.id}`).button, session);
    } else if (result.confident) {
      $('#search-status').textContent = 'Exact match found, but no open-access PDF is listed.';
    }
  } catch (error) {
    if (session === dialogSession) $('#search-status').textContent = error.message;
  } finally {
    if (session === dialogSession) searchButton.disabled = false;
  }
});

async function boot() {
  await refreshLibrary();
  const routeId = paperIdFromPath(window.location.pathname);
  if (routeId) {
    if (papers.some(paper => paper.id === routeId)) {
      await openPaper(routeId, { history: 'replace' });
    } else {
      window.history.replaceState({}, '', '/');
      $('#library-status').textContent = 'The requested paper is no longer in your library.';
      showLibrary(true);
    }
    return;
  }
  const lastId = readingState.lastPaperId;
  if (lastId && papers.some(paper => paper.id === lastId)) {
    await openPaper(lastId, { history: 'replace' });
  } else {
    showLibrary(true);
  }
}

boot().catch(error => { $('#library-status').textContent = error.message; });
