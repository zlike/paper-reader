export const HIGHLIGHT_CLASS = 'link-target-highlight';

const MAX_ENTRY_LINES = 12;

const NEW_REF_START_RE = /^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*\d+[a-z]?\s*\)|\d{1,4}\.\s|\[\s*[A-Za-z][A-Za-z0-9+.-]{1,12}\d{2,4}[a-z]?\s*\])/;
const LEADING_REF_MARKER_RE = /^\s*(?:(?:Reference|Ref\.?)\s+)?(?:\[\s*\d+[a-z]?\s*\]|\(\s*\d+[a-z]?\s*\)|\d{1,4}\.|\[\s*[A-Za-z][A-Za-z0-9+.-]{1,12}\d{2,4}[a-z]?\s*\])\s+/i;
const STANDALONE_PAGE_NUM_RE = /^\s*\d{1,4}\s*$/;
const SECTION_HEADING_RE = /^\s*(?:Appendix|References|Bibliography|Acknowledgments?|Acknowledgements?)\b/i;
const PURE_YEAR_RE = /^(?:19|20)\d{2}[a-z]?$/;

const NON_TERMINATING_ABBREV_RE = /(?:^|[\s(])(?:e\.g|i\.e|vs|Dr|Prof|Mr|Mrs|Ms|St|Jr|Sr|Fig|Eq|No|Vol|pp|ed|eds|Proc|Conf|Trans|Int|Symp|Dept|Univ|CoRR|arXiv)$/i;
const SINGLE_INITIAL_RE = /(?:^|[\s(\-.])[A-Z]$/;

function parseCssPixels(value, referenceSize = 0) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    const pct = Number.parseFloat(trimmed);
    return Number.isFinite(pct) ? (pct / 100) * referenceSize : null;
  }
  const num = Number.parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

function getElementMetrics(element, textLayer, textLength) {
  const layerRect = textLayer.getBoundingClientRect();
  const elRect = element.getBoundingClientRect();

  if (elRect.width > 0 || elRect.height > 0) {
    const left = elRect.left - layerRect.left;
    const top = elRect.top - layerRect.top;
    const right = elRect.right - layerRect.left;
    const height = Math.max(1, elRect.height);
    const bottom = Math.max(elRect.bottom - layerRect.top, top + height);
    return { left, top, right, bottom, height };
  }

  const layerWidth = parseCssPixels(textLayer.style.width) || 600;
  const layerHeight = parseCssPixels(textLayer.style.height) || 800;
  const left = parseCssPixels(element.style.left, layerWidth) ?? 0;
  const top = parseCssPixels(element.style.top, layerHeight) ?? 0;
  const height = Math.max(1, parseCssPixels(element.style.fontSize) || 12);
  const width = Math.max(1, textLength * height * 0.5);
  return { left, top, right: left + width, bottom: top + height, height };
}

export function clearTargetHighlights(root) {
  if (!root) return;
  const marks = root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`);
  const parents = new Set();
  for (const mark of marks) {
    const parent = mark.parentNode;
    parents.add(parent);
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  }
  for (const parent of parents) {
    parent.normalize();
  }
}

export function extractTextItems(textLayer, pageIndex = 0) {
  if (!textLayer) return [];
  const items = [];
  const walker = textLayer.ownerDocument.createTreeWalker(textLayer, 4 /* NodeFilter.SHOW_TEXT */);
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue || '';
    if (text.trim().length > 0 && node.parentElement) {
      const metrics = getElementMetrics(node.parentElement, textLayer, text.length);
      items.push({
        node,
        text,
        left: metrics.left,
        top: metrics.top,
        right: metrics.right,
        bottom: metrics.bottom,
        height: metrics.height,
        pageIndex
      });
    }
    node = walker.nextNode();
  }
  return items;
}

function buildLineFromItems(lineItems) {
  let text = '';
  const segments = [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let maxHeight = 0;

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    if (i > 0) {
      const prev = lineItems[i - 1];
      const gap = item.left - prev.right;
      const spaceThreshold = Math.max(1.5, Math.min(prev.height, item.height) * 0.12);
      if (!/\s$/.test(text) && !/^\s/.test(item.text) && gap > spaceThreshold) {
        text += ' ';
      }
    }
    const start = text.length;
    text += item.text;
    const end = text.length;
    segments.push({
      node: item.node,
      start,
      end,
      nodeStart: 0,
      nodeEnd: item.text.length
    });
    left = Math.min(left, item.left);
    top = Math.min(top, item.top);
    right = Math.max(right, item.right);
    bottom = Math.max(bottom, item.bottom);
    maxHeight = Math.max(maxHeight, item.height);
  }

  return {
    items: lineItems,
    text,
    segments,
    left,
    top,
    right,
    bottom,
    height: maxHeight,
    pageIndex: lineItems[0].pageIndex
  };
}

export function groupItemsIntoLines(items, pageWidth = 0) {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.top - b.top || a.left - b.left);
  const bands = [];

  for (const item of sorted) {
    const band = bands[bands.length - 1];
    if (band) {
      const tolerance = Math.max(4, Math.min(band.height, item.height) * 0.55);
      if (Math.abs(item.top - band.top) <= tolerance) {
        band.items.push(item);
        band.height = Math.max(band.height, item.height);
        continue;
      }
    }
    bands.push({ top: item.top, height: item.height, items: [item] });
  }

  const gutterThreshold = pageWidth > 0 ? Math.max(24, pageWidth * 0.055) : 36;
  const lines = [];

  for (const band of bands) {
    const byX = band.items.sort((a, b) => a.left - b.left);
    let current = [byX[0]];
    for (let i = 1; i < byX.length; i++) {
      const prev = byX[i - 1];
      const item = byX[i];
      if (item.left - prev.right > gutterThreshold) {
        lines.push(buildLineFromItems(current));
        current = [item];
      } else {
        current.push(item);
      }
    }
    lines.push(buildLineFromItems(current));
  }

  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

export function findTargetLineIndex(lines, point) {
  if (!lines.length) return -1;
  const px = Number.isFinite(point?.x) ? point.x : 0;
  const py = Number.isFinite(point?.y) ? point.y : 0;

  let bestIndex = 0;
  let bestScore = Infinity;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let dy = 0;
    if (py < line.top - 4) {
      dy = line.top - py;
    } else if (py > line.bottom + 4) {
      dy = (py - line.bottom) * 1.5;
    }

    let dx = 0;
    if (px < line.left - 12) {
      dx = line.left - px;
    } else if (px > line.right + 12) {
      dx = px - line.right;
    }

    const score = dy + dx * 0.45;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function isSameColumn(line, colMinX, colMaxX) {
  return line.left < colMaxX && line.right > colMinX;
}

function collectPageContinuation(lines, startIndex, entryLines, typicalHeight, firstLine) {
  const baseLeft = firstLine.left;
  let colMinX = baseLeft - 24;
  let colMaxX = firstLine.right + 40;
  let intraGap = null;
  let hasHangingIndent = false;
  let hitBoundary = false;

  for (let i = startIndex; i < lines.length && entryLines.length < MAX_ENTRY_LINES; i++) {
    const line = lines[i];
    const prevLine = entryLines[entryLines.length - 1];
    if (line.top < prevLine.top - 2 || !isSameColumn(line, colMinX, colMaxX)) continue;

    const trimmed = line.text.trim();
    if (STANDALONE_PAGE_NUM_RE.test(trimmed) || SECTION_HEADING_RE.test(trimmed)) {
      hitBoundary = true;
      break;
    }
    if (NEW_REF_START_RE.test(trimmed) && line.left <= baseLeft + 14) {
      hitBoundary = true;
      break;
    }
    const gap = line.top - prevLine.bottom;
    if (
      gap > Math.max(typicalHeight * 0.85, 8) ||
      (intraGap !== null && gap > intraGap + Math.max(4, typicalHeight * 0.35))
    ) {
      hitBoundary = true;
      break;
    }
    if (hasHangingIndent && line.left <= baseLeft + 4) {
      hitBoundary = true;
      break;
    }
    if (gap >= -2) {
      intraGap = intraGap === null ? Math.max(0, gap) : Math.min(intraGap, Math.max(0, gap));
    }
    if (line.left > baseLeft + 6) {
      hasHangingIndent = true;
    }
    entryLines.push(line);
    colMinX = Math.min(colMinX, line.left - 24);
    colMaxX = Math.max(colMaxX, line.right + 40);
  }

  return hitBoundary;
}

export function collectReferenceEntry(targetLines, targetIndex, nextPageLines = []) {
  if (targetIndex < 0 || targetIndex >= targetLines.length) {
    return { lines: [], text: '', segments: [] };
  }

  const firstLine = targetLines[targetIndex];
  const entryLines = [firstLine];
  const typicalHeight = firstLine.height;

  const hitBoundary = collectPageContinuation(
    targetLines,
    targetIndex + 1,
    entryLines,
    typicalHeight,
    firstLine
  );

  if (!hitBoundary && nextPageLines.length > 0 && entryLines.length < MAX_ENTRY_LINES) {
    let startIdx = 0;
    while (startIdx < nextPageLines.length && STANDALONE_PAGE_NUM_RE.test(nextPageLines[startIdx].text.trim())) {
      startIdx++;
    }
    const firstNext = nextPageLines[startIdx];
    const nextTrimmed = firstNext?.text.trim() || '';
    if (nextTrimmed && !NEW_REF_START_RE.test(nextTrimmed) && !SECTION_HEADING_RE.test(nextTrimmed)) {
      entryLines.push(firstNext);
      collectPageContinuation(nextPageLines, startIdx + 1, entryLines, typicalHeight, firstNext);
    }
  }

  let text = '';
  const segments = [];
  for (let i = 0; i < entryLines.length; i++) {
    const line = entryLines[i];
    if (i > 0 && text.length > 0 && !/\s$/.test(text) && !/^\s/.test(line.text)) {
      text += ' ';
    }
    const offset = text.length;
    text += line.text;
    for (const seg of line.segments) {
      segments.push({
        node: seg.node,
        start: seg.start + offset,
        end: seg.end + offset,
        nodeStart: seg.nodeStart,
        nodeEnd: seg.nodeEnd
      });
    }
  }

  return { lines: entryLines, text, segments };
}

function trimRange(text, start, end) {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /[\s.,;:]+/.test(text[e - 1])) e--;
  return s < e ? { start: s, end: e } : null;
}

function findSentenceEnd(text, fromIndex) {
  for (let i = fromIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '?' && ch !== '!') continue;
    const next = text[i + 1];
    const atBoundary = next === undefined || /\s/.test(next);
    if (!atBoundary) continue;

    if (ch === '.') {
      const before = text.slice(fromIndex, i);
      if (/\d$/.test(before) && /^\d/.test(text.slice(i + 1))) continue;
      if (SINGLE_INITIAL_RE.test(before)) continue;
      if (NON_TERMINATING_ABBREV_RE.test(before)) continue;
    }
    return i;
  }
  return text.length;
}

function splitCitationSegments(text, startOffset) {
  const segments = [];
  let cursor = startOffset;

  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
    if (cursor >= text.length) break;

    const end = findSentenceEnd(text, cursor);
    const trimmed = trimRange(text, cursor, end);
    if (trimmed) {
      segments.push({ ...trimmed, text: text.slice(trimmed.start, trimmed.end) });
    }
    cursor = end + 1;
  }

  return segments;
}

function isReasonableTitle(candidate) {
  if (!candidate || candidate.length < 5) return false;
  if (/^https?:\/\//i.test(candidate)) return false;
  if (PURE_YEAR_RE.test(candidate)) return false;
  if (/^(?:pp\.?\s*)?\d+(?:\s*[-–—]\s*\d+)?$/i.test(candidate)) return false;
  return /[A-Za-z]{2,}/.test(candidate);
}

export function extractTitleRange(entryText) {
  if (!entryText || typeof entryText !== 'string') return null;

  // 1. Quoted titles: "Title", “Title”, or ``Title''
  const quotePatterns = [
    /"([^"\n]{6,})"/,
    /“([^”\n]{6,})”/,
    /``([^'\n]{6,})''/
  ];
  for (const pattern of quotePatterns) {
    const match = pattern.exec(entryText);
    if (match) {
      const openLen = pattern.source.startsWith('``') ? 2 : 1;
      const range = trimRange(entryText, match.index + openLen, match.index + openLen + match[1].length);
      if (range && isReasonableTitle(entryText.slice(range.start, range.end))) {
        return range;
      }
    }
  }

  // 2. Author-year style with parenthesized year: Smith et al. (2020). Title. Venue
  const yearParenRe = /\(\s*(?:19|20)\d{2}[a-z]?\s*\)[.,:;]?\s+/;
  const yearMatch = yearParenRe.exec(entryText);
  if (yearMatch) {
    const afterYear = yearMatch.index + yearMatch[0].length;
    const sentenceEnd = findSentenceEnd(entryText, afterYear);
    const range = trimRange(entryText, afterYear, sentenceEnd);
    if (range && isReasonableTitle(entryText.slice(range.start, range.end))) {
      return range;
    }
  }

  // 3. Strip leading citation marker ([1], 1., (1), [Vas17], Reference [1])
  const markerMatch = LEADING_REF_MARKER_RE.exec(entryText);
  const bodyStart = markerMatch ? markerMatch[0].length : 0;

  // 4. Handle "et al., Title" comma-separated style
  const etAlCommaRe = /\bet\s+al\.,\s+/i;
  const etAlComma = etAlCommaRe.exec(entryText.slice(bodyStart));
  if (etAlComma) {
    const titleStart = bodyStart + etAlComma.index + etAlComma[0].length;
    const afterEtAl = entryText.slice(titleStart);
    const venueComma = /,\s+(?:in\s+|Proc\.|NeurIPS|ICML|ICLR|CVPR|ACL|EMNLP|AAAI|IEEE|ACM|arXiv|Vol\.|pp\.|(?:19|20)\d{2}\b)/i.exec(afterEtAl);
    const sentenceEnd = findSentenceEnd(entryText, titleStart);
    const end = venueComma ? Math.min(titleStart + venueComma.index, sentenceEnd) : sentenceEnd;
    const range = trimRange(entryText, titleStart, end);
    if (range && isReasonableTitle(entryText.slice(range.start, range.end))) {
      return range;
    }
  }

  // 5. Sentence segmentation for numbered / author-dot styles: Authors. Title. Venue.
  const segments = splitCitationSegments(entryText, bodyStart);
  if (segments.length >= 2) {
    let titleIdx = 1;
    if (PURE_YEAR_RE.test(segments[titleIdx].text) && segments.length >= 3) {
      titleIdx = 2;
    }
    const candidate = segments[titleIdx];
    if (isReasonableTitle(candidate.text)) {
      return { start: candidate.start, end: candidate.end };
    }
  }

  // 6. Single-segment reference with leading citation marker (e.g. "[1] Transformers for Everyone")
  if (markerMatch && segments.length === 1 && isReasonableTitle(segments[0].text)) {
    return { start: segments[0].start, end: segments[0].end };
  }

  return null;
}

export function applyHighlightRange(segments, start, end) {
  if (!segments?.length || start >= end) return [];
  const marks = [];

  // Group slices per text node so we can replace each node cleanly once.
  const slicesByNode = new Map();
  for (const seg of segments) {
    if (!seg.node || seg.end <= start || seg.start >= end) continue;
    const overlapStart = Math.max(start, seg.start) - seg.start + seg.nodeStart;
    const overlapEnd = Math.min(end, seg.end) - seg.start + seg.nodeStart;
    if (overlapStart >= overlapEnd) continue;
    let list = slicesByNode.get(seg.node);
    if (!list) {
      list = [];
      slicesByNode.set(seg.node, list);
    }
    list.push({ start: overlapStart, end: overlapEnd });
  }

  for (const [node, slices] of slicesByNode.entries()) {
    const parent = node.parentNode;
    const value = node.nodeValue || '';
    const ownerDoc = node.ownerDocument;
    const ordered = slices.sort((a, b) => a.start - b.start);
    const fragment = ownerDoc.createDocumentFragment();
    let cursor = 0;

    for (const slice of ordered) {
      const s = Math.max(cursor, slice.start);
      const e = Math.min(value.length, slice.end);
      if (s > cursor) {
        fragment.appendChild(ownerDoc.createTextNode(value.slice(cursor, s)));
      }
      const mark = ownerDoc.createElement('mark');
      mark.className = HIGHLIGHT_CLASS;
      mark.textContent = value.slice(s, e);
      fragment.appendChild(mark);
      marks.push(mark);
      cursor = e;
    }

    if (cursor < value.length) {
      fragment.appendChild(ownerDoc.createTextNode(value.slice(cursor)));
    }

    parent.replaceChild(fragment, node);
  }

  return marks;
}

export function highlightLinkTarget({ targetTextLayer, nextTextLayer = null, point }) {
  clearTargetHighlights(targetTextLayer);
  clearTargetHighlights(nextTextLayer);
  if (!targetTextLayer) return { marks: [], text: '', entryText: '', matchedTitle: false };

  const targetWidth = targetTextLayer.getBoundingClientRect().width;
  const targetItems = extractTextItems(targetTextLayer, 0);
  const targetLines = groupItemsIntoLines(targetItems, targetWidth);
  const targetIndex = findTargetLineIndex(targetLines, point);
  if (targetIndex < 0) {
    return { marks: [], text: '', entryText: '', matchedTitle: false };
  }

  const nextLines = nextTextLayer
    ? groupItemsIntoLines(extractTextItems(nextTextLayer, 1), nextTextLayer.getBoundingClientRect().width || targetWidth)
    : [];

  const entry = collectReferenceEntry(targetLines, targetIndex, nextLines);
  const titleRange = extractTitleRange(entry.text);
  const range = titleRange || trimRange(entry.text, 0, entry.text.length);
  const marks = applyHighlightRange(entry.segments, range.start, range.end);
  return {
    marks,
    text: entry.text.slice(range.start, range.end),
    entryText: entry.text,
    matchedTitle: Boolean(titleRange)
  };
}
