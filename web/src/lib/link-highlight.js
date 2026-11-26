import { sanitizeTitleForSearch } from './dehyphenate.js';

export { sanitizeTitleForSearch };
export const HIGHLIGHT_CLASS = 'link-target-highlight';

const MAX_ENTRY_LINES = 40;

const NEW_REF_START_RE = /^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*\d+[a-z]?\s*\)|(?!19\d{2}\.|20\d{2}\.)\d{1,3}\.\s|\[\s*[A-Za-z][A-Za-z0-9+.-]{1,12}\d{2,4}[a-z]?\s*\])/;
const LEADING_REF_MARKER_RE = /^\s*(?:(?:Reference|Ref\.?)\s+)?(?:\[\s*\d+[a-z]?\s*\]|\(\s*\d+[a-z]?\s*\)|(?!19\d{2}\.|20\d{2}\.)\d{1,3}\.|\[\s*[A-Za-z][A-Za-z0-9+.-]{1,12}\d{2,4}[a-z]?\s*\])\s+/i;
const STANDALONE_PAGE_NUM_RE = /^\s*\d{1,4}\s*$/;
const SECTION_HEADING_RE = /^\s*(?:Appendix|References|Bibliography|Acknowledgments?|Acknowledgements?)\b/i;
const PURE_YEAR_RE = /^(?:19|20)\d{2}[a-z]?$/;

const NON_TERMINATING_ABBREV_RE = /(?:^|[\s(])(?:e\.g|i\.e|vs|Dr|Prof|Mr|Mrs|Ms|St|Jr|Sr|Fig|Eq|No|Vol|pp|ed|eds|Proc|Conf|Trans|Int|Symp|Dept|Univ|CoRR|arXiv)$/i;
const SINGLE_INITIAL_RE = /(?:^|[\s(\-.])[A-Z]$/;
const NEXT_INITIAL_RE = /^\s+(?:[A-Z]\.|-\s*[A-Z]\.)/;
const AUTHOR_CONNECTOR_RE = /^\s+(?:and|&|et\s+al\.?)\b/i;
const SURNAME_FOLLOW_RE = /^(?:(?:[Dd]e|[Dd]el|[Dd]ella|[Dd]al|[Vv]an|[Vv]on|[Dd]er|[Dd]en|[Ll]a|[Ll]e|[Dd]a|[Dd]i|[Dd]u|[Aa]l|[Bb]in|[Ss]t\.?)\s+)*[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ']+(?:-\s*[A-Za-zÀ-ÖØ-öø-ÿ']+)*(?:\s*(?:,|&|\band\b|\bet\s+al\.?|\.(?:\s|$)))/;
const LAST_COMMA_INITIAL_RE = /(?:^|[\s;])([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'-]{1,}),\s*(?:[A-Z]\.(?:\s*-\s*|\s+))*[A-Z]$/;
const PRECEDED_BY_INITIAL_RE = /[A-Z]\.\s+(?:(?:[Dd]e|[Dd]el|[Dd]ella|[Dd]al|[Vv]an|[Vv]on|[Dd]er|[Dd]en|[Ll]a|[Ll]e|[Dd]a|[Dd]i|[Dd]u|[Aa]l|[Bb]in|[Ss]t\.?)\s+)*[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'-]{1,},\s*(?:[A-Z]\.(?:\s*-\s*|\s+))*[A-Z]$/;
const AUTHOR_REF_START_RE = /^\s*[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'-]+,\s+[A-Z]\./;
const VENUE_CUE_START_RE = /^\s+(?:in\s+|arXiv\b|https?:|doi:|pp\.|vol\.|url\b)/i;
const TRAILING_DATE_RE = /,\s+(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:19|20)\d{2}[a-z]?$/i;
const TRAILING_VENUE_CUE_RE = /,?\s+(?:URL\s+https?:|https?:\/\/|doi:\s*10\.|arXiv(?:\s+preprint)?(?:\s+arXiv)?:).*$/i;
const TRAILING_BACKREF_RE = /\s+\d{1,3}(?:,\s*\d{1,3})*$/;

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

function buildLineFromItems(lineItems, columnIndex = 0) {
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
    pageIndex: lineItems[0].pageIndex,
    columnIndex
  };
}

export function detectColumns(items, pageWidth = 0) {
  if (!items || items.length < 2) return null;
  let maxRight = 0;
  for (const item of items) {
    if (item.right > maxRight) maxRight = item.right;
  }
  const width = pageWidth > 0 ? pageWidth : maxRight;
  if (width <= 0) return null;

  const candidates = [];
  for (const item of items) {
    const trimmed = item.text.trim();
    if (!trimmed || STANDALONE_PAGE_NUM_RE.test(trimmed)) continue;
    const itemWidth = item.right - item.left;
    if (itemWidth > width * 0.48) continue;
    candidates.push(item);
  }
  if (candidates.length < 2) return null;

  const binCount = Math.ceil(width) + 1;
  const occupancy = new Uint16Array(binCount);
  for (const item of candidates) {
    const start = Math.max(0, Math.floor(item.left));
    const end = Math.min(binCount - 1, Math.ceil(item.right));
    for (let x = start; x <= end; x++) {
      occupancy[x]++;
    }
  }

  const searchStart = Math.max(0, Math.floor(width * 0.28));
  const searchEnd = Math.min(binCount - 1, Math.ceil(width * 0.72));
  const minGutter = Math.max(8, width * 0.015);

  const findBestValley = maxAllowed => {
    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    for (let x = searchStart; x <= searchEnd; x++) {
      if (occupancy[x] <= maxAllowed) {
        if (curStart === -1) curStart = x;
      } else {
        if (curStart !== -1 && x - curStart > bestLen) {
          bestStart = curStart;
          bestLen = x - curStart;
        }
        curStart = -1;
      }
    }
    if (curStart !== -1 && searchEnd + 1 - curStart > bestLen) {
      bestStart = curStart;
      bestLen = searchEnd + 1 - curStart;
    }
    return bestLen >= minGutter ? { gapStart: bestStart, gapEnd: bestStart + bestLen } : null;
  };

  let valley = findBestValley(0);
  if (!valley && candidates.length >= 10) {
    valley = findBestValley(1);
  }
  if (!valley) return null;

  const splitX = (valley.gapStart + valley.gapEnd) / 2;
  let leftCount = 0;
  let rightCount = 0;
  let crossingCount = 0;
  let leftMinY = Infinity;
  let leftMaxY = -Infinity;
  let rightMinY = Infinity;
  let rightMaxY = -Infinity;

  for (const item of items) {
    const trimmed = item.text.trim();
    if (!trimmed || STANDALONE_PAGE_NUM_RE.test(trimmed)) continue;
    if (item.right <= splitX + 4) {
      leftCount++;
      leftMinY = Math.min(leftMinY, item.top);
      leftMaxY = Math.max(leftMaxY, item.bottom);
    } else if (item.left >= splitX - 4) {
      rightCount++;
      rightMinY = Math.min(rightMinY, item.top);
      rightMaxY = Math.max(rightMaxY, item.bottom);
    } else {
      crossingCount++;
    }
  }

  const minSide = items.length >= 8 ? 2 : 1;
  if (leftCount < minSide || rightCount < minSide) return null;
  const totalNonPage = leftCount + rightCount + crossingCount;
  if (crossingCount > Math.max(2, Math.floor(totalNonPage * 0.12))) return null;
  if (Math.min(leftMaxY, rightMaxY) < Math.max(leftMinY, rightMinY) - 20) return null;

  return { splitX, gapStart: valley.gapStart, gapEnd: valley.gapEnd };
}

function groupBucketIntoLines(bucketItems, columnIndex, gutterThreshold) {
  if (!bucketItems.length) return [];
  const sorted = [...bucketItems].sort((a, b) => a.top - b.top || a.left - b.left);
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

  const lines = [];
  for (const band of bands) {
    const byX = band.items.sort((a, b) => a.left - b.left);
    let current = [byX[0]];
    for (let i = 1; i < byX.length; i++) {
      const prev = byX[i - 1];
      const item = byX[i];
      if (gutterThreshold !== null && item.left - prev.right > gutterThreshold) {
        lines.push(buildLineFromItems(current, columnIndex));
        current = [item];
      } else {
        current.push(item);
      }
    }
    lines.push(buildLineFromItems(current, columnIndex));
  }

  return lines;
}

export function groupItemsIntoLines(items, pageWidth = 0) {
  if (!items.length) return [];

  const colSplit = detectColumns(items, pageWidth);
  if (colSplit) {
    const leftBucket = [];
    const rightBucket = [];
    const spanningBucket = [];

    for (const item of items) {
      if (item.right <= colSplit.splitX + 4) {
        leftBucket.push(item);
      } else if (item.left >= colSplit.splitX - 4) {
        rightBucket.push(item);
      } else {
        spanningBucket.push(item);
      }
    }

    const lines = [
      ...groupBucketIntoLines(leftBucket, 0, null),
      ...groupBucketIntoLines(rightBucket, 1, null),
      ...groupBucketIntoLines(spanningBucket, -1, null)
    ];
    return lines.sort((a, b) => a.top - b.top || a.left - b.left);
  }

  const gutterThreshold = pageWidth > 0 ? Math.max(24, pageWidth * 0.055) : 36;
  const lines = groupBucketIntoLines(items, 0, gutterThreshold);
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

function selectTargetColumn(lines, px) {
  const columns = new Map();
  for (const line of lines) {
    const col = line.columnIndex ?? 0;
    if (col < 0) continue;
    let bounds = columns.get(col);
    if (!bounds) {
      bounds = { col, left: line.left, right: line.right };
      columns.set(col, bounds);
    } else {
      bounds.left = Math.min(bounds.left, line.left);
      bounds.right = Math.max(bounds.right, line.right);
    }
  }
  if (columns.size <= 1) return null;

  const colList = [...columns.values()].sort((a, b) => a.left - b.left);

  // PDF hyperref XYZ destinations often place point.x ~15-30px left of the target column's left edge.
  let bestMarginCol = null;
  let bestMarginDist = Infinity;
  for (const c of colList) {
    const offsetLeft = c.left - px;
    if (offsetLeft >= -12 && offsetLeft <= 42) {
      const dist = Math.abs(offsetLeft);
      if (dist < bestMarginDist) {
        bestMarginDist = dist;
        bestMarginCol = c.col;
      }
    }
  }
  if (bestMarginCol !== null) return bestMarginCol;

  for (const c of colList) {
    if (px >= c.left && px <= c.right) return c.col;
  }

  let closestCol = colList[0].col;
  let closestDist = Infinity;
  for (const c of colList) {
    const dist = px < c.left ? c.left - px : px - c.right;
    if (dist < closestDist) {
      closestDist = dist;
      closestCol = c.col;
    }
  }
  return closestCol;
}

export function findTargetLineIndex(lines, point) {
  if (!lines.length) return -1;
  const px = Number.isFinite(point?.x) ? point.x : 0;
  const py = Number.isFinite(point?.y) ? point.y : 0;
  const targetCol = selectTargetColumn(lines, px);

  let bestIndex = -1;
  let bestScore = Infinity;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (targetCol !== null && (line.columnIndex ?? 0) !== targetCol) continue;

    let dy = 0;
    if (py < line.top - 4) {
      dy = line.top - py;
    } else if (py > line.bottom + 4) {
      dy = (py - line.bottom) * 1.5;
    }

    // When a PDF destination sits below a section heading (e.g. "References"),
    // prefer the first reference line below the heading rather than the heading itself.
    if (py > line.bottom && SECTION_HEADING_RE.test(line.text.trim())) {
      dy += Math.max(24, line.height * 2.5);
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

  return bestIndex >= 0 ? bestIndex : 0;
}

function isSameColumn(line, colMinX, colMaxX, targetCol) {
  if (targetCol !== null) {
    return (line.columnIndex ?? 0) === targetCol;
  }
  return line.left < colMaxX && line.right > colMinX;
}

function collectPageContinuation(lines, startIndex, entryLines, typicalHeight, firstLine, targetCol = null) {
  const baseLeft = firstLine.left;
  let colMinX = baseLeft - 24;
  let colMaxX = firstLine.right + 40;
  let intraGap = null;
  let hasHangingIndent = false;
  let hitBoundary = false;

  for (let i = startIndex; i < lines.length && entryLines.length < MAX_ENTRY_LINES; i++) {
    const line = lines[i];
    const prevLine = entryLines[entryLines.length - 1];
    if (line.top < prevLine.top - 2 || !isSameColumn(line, colMinX, colMaxX, targetCol)) continue;

    const trimmed = line.text.trim();
    if (SECTION_HEADING_RE.test(trimmed)) {
      hitBoundary = true;
      break;
    }
    if (STANDALONE_PAGE_NUM_RE.test(trimmed)) {
      // A standalone number at the very end of the page/column is a page footer,
      // which should not block cross-page continuation of an incomplete entry.
      const hasMoreInCol = lines.slice(i + 1).some(
        nextLine => nextLine.top >= line.top - 2 && isSameColumn(nextLine, colMinX, colMaxX, targetCol)
      );
      if (hasMoreInCol) {
        hitBoundary = true;
      }
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

  return { hitBoundary, hasHangingIndent };
}

function hasMultiColumnLines(lines) {
  let hasCol0 = false;
  let hasCol1 = false;
  for (const line of lines) {
    if (line.columnIndex === 0) hasCol0 = true;
    else if (line.columnIndex === 1) hasCol1 = true;
    if (hasCol0 && hasCol1) return true;
  }
  return false;
}

function shouldContinueAcrossBreak(entryLines, hasHangingIndent, continuationLines) {
  if (!continuationLines.length) return false;
  const firstNext = continuationLines[0];
  const nextTrimmed = firstNext.text.trim();
  if (!nextTrimmed || NEW_REF_START_RE.test(nextTrimmed) || SECTION_HEADING_RE.test(nextTrimmed)) {
    return false;
  }

  // If the next column/page starts with an unindented first line of a hanging-indent entry,
  // it is a new reference rather than a wrapped continuation.
  if (continuationLines.length >= 2 && continuationLines[1].left > firstNext.left + 6) {
    return false;
  }

  // If the next line starts with a new "Last, F." author entry and current entry looks complete.
  if (AUTHOR_REF_START_RE.test(nextTrimmed)) {
    const currentText = entryLines.map(l => l.text.trim()).join(' ');
    if (/[.?!](?:\s+\d{1,3}(?:,\s*\d{1,3})*)?$/.test(currentText) || hasHangingIndent) {
      return false;
    }
  }

  return true;
}

function getColumnContinuationCandidates(lines, columnIndex) {
  const filtered = columnIndex !== null
    ? lines.filter(l => (l.columnIndex ?? 0) === columnIndex)
    : lines.filter(l => (l.columnIndex ?? 0) >= 0);

  let startIdx = 0;
  while (startIdx < filtered.length && STANDALONE_PAGE_NUM_RE.test(filtered[startIdx].text.trim())) {
    startIdx++;
  }
  return filtered.slice(startIdx);
}

export function collectReferenceEntry(targetLines, targetIndex, nextPageLines = []) {
  if (targetIndex < 0 || targetIndex >= targetLines.length) {
    return { lines: [], text: '', segments: [] };
  }

  const firstLine = targetLines[targetIndex];
  const entryLines = [firstLine];
  const typicalHeight = firstLine.height;
  const isTargetMultiCol = hasMultiColumnLines(targetLines);
  const targetCol = isTargetMultiCol ? (firstLine.columnIndex ?? 0) : null;

  const { hitBoundary, hasHangingIndent } = collectPageContinuation(
    targetLines,
    targetIndex + 1,
    entryLines,
    typicalHeight,
    firstLine,
    targetCol
  );

  if (!hitBoundary && entryLines.length < MAX_ENTRY_LINES) {
    if (isTargetMultiCol && targetCol === 0) {
      // Continue from bottom of left column to top of right column on the same page
      const rightColCandidates = getColumnContinuationCandidates(targetLines, 1);
      if (shouldContinueAcrossBreak(entryLines, hasHangingIndent, rightColCandidates)) {
        const firstNext = rightColCandidates[0];
        entryLines.push(firstNext);
        collectPageContinuation(rightColCandidates, 1, entryLines, typicalHeight, firstNext, 1);
      }
    } else if (nextPageLines.length > 0) {
      // Continue from bottom of last column onto top of first column of next page
      const isNextMultiCol = hasMultiColumnLines(nextPageLines);
      const nextCandidates = getColumnContinuationCandidates(nextPageLines, isNextMultiCol ? 0 : null);
      if (shouldContinueAcrossBreak(entryLines, hasHangingIndent, nextCandidates)) {
        const firstNext = nextCandidates[0];
        entryLines.push(firstNext);
        collectPageContinuation(
          nextCandidates,
          1,
          entryLines,
          typicalHeight,
          firstNext,
          isNextMultiCol ? 0 : null
        );
      }
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

function refineTitleRange(text, start, end) {
  let range = trimRange(text, start, end);
  if (!range) return null;

  let slice = text.slice(range.start, range.end);
  const venueMatch = TRAILING_VENUE_CUE_RE.exec(slice);
  if (venueMatch && venueMatch.index > 0) {
    range = trimRange(text, range.start, range.start + venueMatch.index);
    if (!range) return null;
    slice = text.slice(range.start, range.end);
  }

  const dateMatch = TRAILING_DATE_RE.exec(slice);
  if (dateMatch && dateMatch.index > 0) {
    range = trimRange(text, range.start, range.start + dateMatch.index);
    if (!range) return null;
    slice = text.slice(range.start, range.end);
  }

  const backrefMatch = TRAILING_BACKREF_RE.exec(slice);
  if (backrefMatch && backrefMatch.index > 0 && /[.?!]$/.test(slice.slice(0, backrefMatch.index))) {
    range = trimRange(text, range.start, range.start + backrefMatch.index);
  }

  return range;
}

function shouldSkipSingleInitialPeriod(before, after) {
  if (NEXT_INITIAL_RE.test(after) || AUTHOR_CONNECTOR_RE.test(after)) {
    return true;
  }

  const afterTrim = after.trimStart();
  if (!SURNAME_FOLLOW_RE.test(afterTrim)) {
    return false;
  }

  // In "Last, F." format, the initial is at the end of the author name, so it terminates
  // the author list unless it was actually preceded by a first initial ("K. He, X. Zhang").
  if (LAST_COMMA_INITIAL_RE.test(before) && !PRECEDED_BY_INITIAL_RE.test(before)) {
    return false;
  }

  return true;
}

function findSentenceEnd(text, fromIndex) {
  for (let i = fromIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '?' && ch !== '!') continue;
    const next = text[i + 1];
    const atBoundary = next === undefined || /\s/.test(next);
    if (!atBoundary) continue;

    const after = text.slice(i + 1);
    if (ch === '.') {
      const before = text.slice(fromIndex, i);
      if (/\d$/.test(before) && /^\d/.test(after)) continue;
      if (SINGLE_INITIAL_RE.test(before) && shouldSkipSingleInitialPeriod(before, after)) continue;
      if (NON_TERMINATING_ABBREV_RE.test(before)) continue;
    } else {
      const before = text.slice(fromIndex, i);
      const isShortTitlePrefix = before.trim().length <= 12 && /^\s+[A-Za-z]/.test(after);
      if ((/^\s+[a-z]/.test(after) || isShortTitlePrefix) && !VENUE_CUE_START_RE.test(after)) {
        // Internal '!' or '?' inside a title (e.g. "Explain yourself! leveraging..." or "WT5?! Training...")
        continue;
      }
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
    const includeEndPunct = end < text.length && (text[end] === '?' || text[end] === '!');
    const trimmed = trimRange(text, cursor, includeEndPunct ? end + 1 : end);
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

  // 1. Quoted titles: "Title", “Title”, or ``Title'' (must begin at a citation boundary)
  const quotePatterns = [
    /(?:^|[\].,;):]\s+)"([^"\n]{6,})"/,
    /(?:^|[\].,;):]\s+)“([^”\n]{6,})”/,
    /(?:^|[\].,;):]\s+)``([^'\n]{6,})''/
  ];
  for (const pattern of quotePatterns) {
    const match = pattern.exec(entryText);
    if (match) {
      const openLen = pattern.source.includes('``') ? 2 : 1;
      const closeLen = openLen;
      const quoteStart = match.index + match[0].length - match[1].length - closeLen;
      const range = trimRange(entryText, quoteStart, quoteStart + match[1].length);
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
    const includeEndPunct = sentenceEnd < entryText.length && (entryText[sentenceEnd] === '?' || entryText[sentenceEnd] === '!');
    const range = refineTitleRange(entryText, afterYear, includeEndPunct ? sentenceEnd + 1 : sentenceEnd);
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
    const includeEndPunct = sentenceEnd < entryText.length && (entryText[sentenceEnd] === '?' || entryText[sentenceEnd] === '!');
    const rawEnd = venueComma ? Math.min(titleStart + venueComma.index, sentenceEnd) : (includeEndPunct ? sentenceEnd + 1 : sentenceEnd);
    const range = refineTitleRange(entryText, titleStart, rawEnd);
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
    const candidate = refineTitleRange(entryText, segments[titleIdx].start, segments[titleIdx].end);
    if (candidate && isReasonableTitle(entryText.slice(candidate.start, candidate.end))) {
      return candidate;
    }
  }

  // 6. Single-segment reference with leading citation marker (e.g. "[1] Transformers for Everyone")
  if (markerMatch && segments.length === 1) {
    const candidate = refineTitleRange(entryText, segments[0].start, segments[0].end);
    if (candidate && isReasonableTitle(entryText.slice(candidate.start, candidate.end))) {
      return candidate;
    }
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
  if (!targetTextLayer) return { marks: [], text: '', entryText: '', matchedTitle: false, searchTitle: '' };

  const targetWidth = targetTextLayer.getBoundingClientRect().width;
  const targetItems = extractTextItems(targetTextLayer, 0);
  const targetLines = groupItemsIntoLines(targetItems, targetWidth);
  const targetIndex = findTargetLineIndex(targetLines, point);
  if (targetIndex < 0) {
    return { marks: [], text: '', entryText: '', matchedTitle: false, searchTitle: '' };
  }

  const nextLines = nextTextLayer
    ? groupItemsIntoLines(extractTextItems(nextTextLayer, 1), nextTextLayer.getBoundingClientRect().width || targetWidth)
    : [];

  const entry = collectReferenceEntry(targetLines, targetIndex, nextLines);
  const titleRange = extractTitleRange(entry.text);
  const range = titleRange || trimRange(entry.text, 0, entry.text.length);
  const marks = applyHighlightRange(entry.segments, range.start, range.end);
  const text = entry.text.slice(range.start, range.end);
  return {
    marks,
    text,
    entryText: entry.text,
    matchedTitle: Boolean(titleRange),
    searchTitle: sanitizeTitleForSearch(text)
  };
}
