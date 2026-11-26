const LINK_ANNOTATION = 'Link';
const PAGE_ACTIONS = new Set(['FirstPage', 'LastPage', 'NextPage', 'PrevPage']);

export function isSafeExternalUrl(value) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isSupportedLink(annotation) {
  if (annotation.subtype !== LINK_ANNOTATION) return false;
  if (annotation.url) return isSafeExternalUrl(annotation.url);
  if (annotation.unsafeUrl) return false;
  return Boolean(annotation.dest) || PAGE_ACTIONS.has(annotation.action);
}

export function findLinkAtPoint(page, clientX, clientY) {
  if (!page) return null;
  for (const link of page.querySelectorAll('.linkAnnotation > a')) {
    const rect = link.getBoundingClientRect();
    if (
      rect.right > rect.left && rect.bottom > rect.top &&
      clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom
    ) {
      return link;
    }
  }
  return null;
}

export async function resolveDestination(document, destination) {
  const explicit = typeof destination === 'string'
    ? await document.getDestination(destination)
    : destination;
  if (!Array.isArray(explicit) || explicit.length < 2) throw new Error('PDF link destination not found.');
  const reference = explicit[0];
  const pageIndex = Number.isInteger(reference) ? reference : await document.getPageIndex(reference);
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.numPages) {
    throw new Error('PDF link points to an invalid page.');
  }
  return { pageNumber: pageIndex + 1, destination: explicit };
}

export function destinationPosition(page, viewport, destination) {
  const kind = destination[1]?.name;
  const [left, , , top] = page.view;
  if (kind === 'Fit' || kind === 'FitB') return { x: 0, y: 0 };
  let x = left;
  let y = top;
  if (kind === 'XYZ') {
    x = destination[2] ?? left;
    y = destination[3] ?? top;
  } else if (kind === 'FitH' || kind === 'FitBH') {
    y = destination[2] ?? top;
  } else if (kind === 'FitV' || kind === 'FitBV') {
    x = destination[2] ?? left;
  } else if (kind === 'FitR') {
    if (destination.slice(2, 6).length !== 4 || !destination.slice(2, 6).every(Number.isFinite)) {
      throw new Error('Invalid PDF link destination.');
    }
    const rect = viewport.convertToViewportRectangle(destination.slice(2, 6));
    return { x: Math.min(rect[0], rect[2]), y: Math.min(rect[1], rect[3]) };
  } else {
    throw new Error('Unsupported PDF link destination.');
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid PDF link destination.');
  const point = viewport.convertToViewportPoint(x, y);
  return { x: point[0], y: point[1] };
}

export const PREVIEW_NEXT_PAGE_THRESHOLD = 0.6;
const PREVIEW_SCROLL_TOP_MARGIN = 24;
const PREVIEW_SCROLL_LEFT_MARGIN = 16;

export function computePreviewTarget(page, viewport, destination, pageNumber, numPages) {
  const raw = destinationPosition(page, viewport, destination);
  const clampedX = Math.max(0, Math.min(raw.x, viewport.width));
  const clampedY = Math.max(0, Math.min(raw.y, viewport.height));
  const includeNextPage =
    pageNumber < numPages &&
    viewport.height > 0 &&
    clampedY / viewport.height >= PREVIEW_NEXT_PAGE_THRESHOLD;
  return {
    x: clampedX,
    y: clampedY,
    scrollTop: Math.max(0, Math.round(clampedY - PREVIEW_SCROLL_TOP_MARGIN)),
    scrollLeft: Math.max(0, Math.round(clampedX - PREVIEW_SCROLL_LEFT_MARGIN)),
    includeNextPage
  };
}
