import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_CLASS,
  applyHighlightRange,
  clearTargetHighlights,
  collectReferenceEntry,
  extractTextItems,
  extractTitleRange,
  findTargetLineIndex,
  groupItemsIntoLines,
  highlightLinkTarget
} from '../src/lib/link-highlight.js';

function createSpan(text, { left = 0, top = 0, width, height = 12, useRect = true, styleLeft, styleTop, fontSize } = {}) {
  const span = document.createElement('span');
  span.textContent = text;
  if (styleLeft !== undefined) span.style.left = styleLeft;
  if (styleTop !== undefined) span.style.top = styleTop;
  if (fontSize !== undefined) span.style.fontSize = fontSize;
  if (useRect) {
    const computedWidth = width ?? Math.max(8, text.length * 6);
    span.getBoundingClientRect = () => ({
      left,
      top,
      right: left + computedWidth,
      bottom: top + height,
      width: computedWidth,
      height
    });
  }
  return span;
}

function createTextLayer(spans, { width = 600, height = 800, useRect = true } = {}) {
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  layer.style.width = `${width}px`;
  layer.style.height = `${height}px`;
  if (useRect) {
    layer.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height
    });
  }
  for (const span of spans) {
    layer.appendChild(span);
  }
  return layer;
}

describe('extractTextItems & groupItemsIntoLines', () => {
  it('returns empty arrays for missing or empty inputs', () => {
    expect(extractTextItems(null)).toEqual([]);
    expect(groupItemsIntoLines([])).toEqual([]);
    expect(findTargetLineIndex([], { x: 0, y: 0 })).toBe(-1);
    expect(collectReferenceEntry([], -1)).toEqual({ lines: [], text: '', segments: [] });
  });

  it('extracts items via CSS style fallback (% and px) when layout rects are zero', () => {
    const s1 = createSpan('[1] First', { useRect: false, styleLeft: '10%', styleTop: '20%', fontSize: '14px' });
    const s2 = createSpan('Title', { useRect: false, styleLeft: '140px', styleTop: '160px', fontSize: '14px' });
    const empty = createSpan('   ', { useRect: false, styleLeft: '0px', styleTop: '0px' });
    const layer = createTextLayer([s1, s2, empty], { width: 500, height: 800, useRect: false });

    const items = extractTextItems(layer);
    expect(items).toHaveLength(2);
    expect(items[0].left).toBe(50);
    expect(items[0].top).toBe(160);
    expect(items[1].left).toBe(140);
    expect(items[1].top).toBe(160);
  });

  it('groups spans on the same visual line and splits two-column layouts by gutter gap', () => {
    const layer = createTextLayer([
      createSpan('[1] Left', { left: 40, top: 100, width: 60 }),
      createSpan('Author.', { left: 105, top: 101, width: 50 }),
      createSpan('[10] Right', { left: 320, top: 100, width: 70 }),
      createSpan('Column.', { left: 394, top: 100, width: 55 })
    ], { width: 600 });

    const items = extractTextItems(layer);
    const lines = groupItemsIntoLines(items, 600);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('[1] Left Author.');
    expect(lines[1].text).toBe('[10] Right Column.');
  });
});

describe('findTargetLineIndex', () => {
  it('picks the closest line vertically and disambiguates two columns by X', () => {
    const layer = createTextLayer([
      createSpan('[1] First reference', { left: 40, top: 100, width: 200 }),
      createSpan('[2] Second reference', { left: 40, top: 140, width: 200 }),
      createSpan('[10] Right column ref', { left: 320, top: 140, width: 200 })
    ], { width: 600 });

    const lines = groupItemsIntoLines(extractTextItems(layer), 600);
    // Point slightly above [2] in left column
    expect(findTargetLineIndex(lines, { x: 40, y: 136 })).toBe(1);
    // Point at [10] in right column
    expect(findTargetLineIndex(lines, { x: 320, y: 142 })).toBe(2);
    // Point below all lines still picks closest
    expect(findTargetLineIndex(lines, { x: 40, y: 200 })).toBe(1);
    // Non-finite point defaults to (0, 0)
    expect(findTargetLineIndex(lines, {})).toBe(0);
  });
});

describe('collectReferenceEntry', () => {
  it('stops at next numbered reference marker', () => {
    const layer = createTextLayer([
      createSpan('[1] A. Vaswani et al.', { left: 40, top: 100, width: 220, height: 12 }),
      createSpan('Attention Is All You Need. NeurIPS, 2017.', { left: 56, top: 116, width: 260, height: 12 }),
      createSpan('[2] K. He et al. Deep Residual Learning.', { left: 40, top: 132, width: 260, height: 12 })
    ]);
    const lines = groupItemsIntoLines(extractTextItems(layer), 600);
    const entry = collectReferenceEntry(lines, 0);
    expect(entry.lines).toHaveLength(2);
    expect(entry.text).toBe('[1] A. Vaswani et al. Attention Is All You Need. NeurIPS, 2017.');
  });

  it('stops at hanging-indent reset for unnumbered author-year bibliographies', () => {
    const layer = createTextLayer([
      createSpan('Smith, J., & Doe, A. (2020).', { left: 40, top: 100, width: 220, height: 12 }),
      createSpan('Deep learning for graphs. ICML.', { left: 60, top: 116, width: 220, height: 12 }),
      createSpan('Wang, L. (2021). Another paper.', { left: 40, top: 132, width: 220, height: 12 })
    ]);
    const lines = groupItemsIntoLines(extractTextItems(layer), 600);
    const entry = collectReferenceEntry(lines, 0);
    expect(entry.lines).toHaveLength(2);
    expect(entry.text).toContain('Deep learning for graphs');
    expect(entry.text).not.toContain('Wang');
  });

  it('stops at vertical paragraph gap and standalone page numbers', () => {
    const layer = createTextLayer([
      createSpan('Author One. First Paper Title.', { left: 40, top: 100, width: 240, height: 12 }),
      createSpan('In Proc. Conf., 2020.', { left: 40, top: 114, width: 180, height: 12 }),
      createSpan('Author Two. Second Paper Title.', { left: 40, top: 145, width: 240, height: 12 })
    ]);
    const lines = groupItemsIntoLines(extractTextItems(layer), 600);
    const entry = collectReferenceEntry(lines, 0);
    expect(entry.lines).toHaveLength(2);
    expect(entry.text).toBe('Author One. First Paper Title. In Proc. Conf., 2020.');

    const pageNumLayer = createTextLayer([
      createSpan('[1] Author One. First Paper Title.', { left: 40, top: 100, width: 240, height: 12 }),
      createSpan('12', { left: 40, top: 114, width: 20, height: 12 })
    ]);
    const pageNumEntry = collectReferenceEntry(groupItemsIntoLines(extractTextItems(pageNumLayer), 600), 0);
    expect(pageNumEntry.lines).toHaveLength(1);
  });

  it('continues reference entry across a page break onto the next page', () => {
    const targetLayer = createTextLayer([
      createSpan('[9] J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova.', { left: 40, top: 760, width: 320, height: 12 }),
      createSpan('BERT: Pre-training of Deep Bidirectional', { left: 56, top: 776, width: 260, height: 12 })
    ]);
    const nextLayer = createTextLayer([
      createSpan('14', { left: 290, top: 20, width: 20, height: 12 }),
      createSpan('Transformers for Language Understanding. NAACL, 2019.', { left: 56, top: 50, width: 320, height: 12 }),
      createSpan('[10] Next Citation. Another Paper. 2020.', { left: 40, top: 68, width: 260, height: 12 })
    ]);
    const targetLines = groupItemsIntoLines(extractTextItems(targetLayer, 0), 600);
    const nextLines = groupItemsIntoLines(extractTextItems(nextLayer, 1), 600);
    const entry = collectReferenceEntry(targetLines, 0, nextLines);
    expect(entry.lines).toHaveLength(3);
    expect(entry.text).toContain('BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding');
    expect(entry.text).not.toContain('[10]');
  });

  it('does not cross page break if next page starts a new reference or section heading', () => {
    const targetLayer = createTextLayer([
      createSpan('[9] Complete Reference. Title Here. 2019.', { left: 40, top: 760, width: 300, height: 12 })
    ]);
    const nextLayer = createTextLayer([
      createSpan('Appendix A: Proofs', { left: 40, top: 50, width: 160, height: 12 })
    ]);
    const targetLines = groupItemsIntoLines(extractTextItems(targetLayer, 0), 600);
    const nextLines = groupItemsIntoLines(extractTextItems(nextLayer, 1), 600);
    const entry = collectReferenceEntry(targetLines, 0, nextLines);
    expect(entry.lines).toHaveLength(1);
    expect(entry.text).not.toContain('Appendix');
  });
});

describe('extractTitleRange', () => {
  const slice = (text, range) => (range ? text.slice(range.start, range.end) : null);

  it('extracts quoted titles (straight, curly, and LaTeX quotes)', () => {
    const s1 = '[1] A. Vaswani et al., "Attention Is All You Need," in NeurIPS, 2017.';
    expect(slice(s1, extractTitleRange(s1))).toBe('Attention Is All You Need');

    const s2 = '[2] J. Smith. “Deep Learning for Everyone.” Nature, 2021.';
    expect(slice(s2, extractTitleRange(s2))).toBe('Deep Learning for Everyone');

    const s3 = "[3] K. He et al. ``Deep Residual Learning for Image Recognition,'' CVPR 2016.";
    expect(slice(s3, extractTitleRange(s3))).toBe('Deep Residual Learning for Image Recognition');
  });

  it('extracts titles from author-year parenthesized citations', () => {
    const s1 = 'Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. Advances in NeurIPS, 30.';
    expect(slice(s1, extractTitleRange(s1))).toBe('Attention is all you need');

    const s2 = 'Smith, J., & Doe, A. (2020a) Graph Networks v2.0 vs. Classic Models. Journal of AI.';
    expect(slice(s2, extractTitleRange(s2))).toBe('Graph Networks v2.0 vs. Classic Models');
  });

  it('extracts titles from numbered / author-dot citations', () => {
    const s1 = '[1] K. He, X. Zhang, S. Ren, and J. Sun. Deep residual learning for image recognition. In CVPR, 2016.';
    expect(slice(s1, extractTitleRange(s1))).toBe('Deep residual learning for image recognition');

    const s2 = '2. A. Radford et al. Learning transferable visual models from natural language supervision. ICML, 2021.';
    expect(slice(s2, extractTitleRange(s2))).toBe('Learning transferable visual models from natural language supervision');

    const s3 = 'Smith, J. 2020. Unparenthesized Year Title. ACM Computing Surveys.';
    expect(slice(s3, extractTitleRange(s3))).toBe('Unparenthesized Year Title');
  });

  it('extracts titles from et al. comma-separated and marker-only references', () => {
    const s1 = 'Reference [1] Vaswani et al., Attention Is All You Need, NeurIPS 2017.';
    expect(slice(s1, extractTitleRange(s1))).toBe('Attention Is All You Need');

    const s2 = 'Reference [1] Vaswani et al., Attention Is All You Need';
    expect(slice(s2, extractTitleRange(s2))).toBe('Attention Is All You Need');

    const s3 = '[1] Transformers for Everyone';
    expect(slice(s3, extractTitleRange(s3))).toBe('Transformers for Everyone');
  });

  it('returns null for inputs without a separable title so caller can fall back', () => {
    expect(extractTitleRange('')).toBeNull();
    expect(extractTitleRange(null)).toBeNull();
    expect(extractTitleRange('Introduction to Methodology')).toBeNull();
    expect(extractTitleRange('[1] https://example.org')).toBeNull();
    expect(extractTitleRange('[1] Author. pp. 12-18.')).toBeNull();
  });
});

describe('applyHighlightRange, clearTargetHighlights, and highlightLinkTarget', () => {
  it('wraps only the exact title characters in <mark> across multiple spans and restores cleanly', () => {
    const layer = createTextLayer([
      createSpan('[1] A. Vaswani, N. Shazeer. ', { left: 40, top: 200, width: 170, height: 12 }),
      createSpan('Attention Is All ', { left: 210, top: 200, width: 100, height: 12 }),
      createSpan('You Need. In NeurIPS, 2017.', { left: 56, top: 216, width: 180, height: 12 }),
      createSpan('[2] Other Author. Other Paper. 2018.', { left: 40, top: 234, width: 220, height: 12 })
    ]);

    const result = highlightLinkTarget({
      targetTextLayer: layer,
      point: { x: 40, y: 200 }
    });

    expect(result.matchedTitle).toBe(true);
    expect(result.text).toBe('Attention Is All You Need');
    const marks = layer.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`);
    expect(marks).toHaveLength(2);
    expect(Array.from(marks).map(m => m.textContent).join('')).toBe('Attention Is All You Need');
    expect(layer.textContent).toContain('[1] A. Vaswani, N. Shazeer. Attention Is All You Need. In NeurIPS, 2017.');

    // Clearing highlights removes <mark> elements while keeping exact original text intact
    clearTargetHighlights(layer);
    expect(layer.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)).toHaveLength(0);
    expect(layer.textContent).toContain('Attention Is All You Need');
  });

  it('falls back to highlighting the full target entry when title cannot be separated', () => {
    const layer = createTextLayer([
      createSpan('Section 4: Experimental Setup', { left: 40, top: 120, width: 200, height: 12 })
    ]);

    const result = highlightLinkTarget({
      targetTextLayer: layer,
      point: { x: 40, y: 120 }
    });

    expect(result.matchedTitle).toBe(false);
    expect(result.text).toBe('Section 4: Experimental Setup');
    expect(layer.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)).toHaveLength(1);
  });

  it('highlights title spanning across a page break using targetTextLayer and nextTextLayer', () => {
    const targetLayer = createTextLayer([
      createSpan('[9] J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova.', { left: 40, top: 760, width: 320, height: 12 }),
      createSpan('BERT: Pre-training of Deep Bidirectional', { left: 56, top: 776, width: 260, height: 12 })
    ]);
    const nextLayer = createTextLayer([
      createSpan('Transformers for Language Understanding. NAACL, 2019.', { left: 56, top: 40, width: 320, height: 12 }),
      createSpan('[10] Next Citation. Another Paper. 2020.', { left: 40, top: 58, width: 260, height: 12 })
    ]);

    const result = highlightLinkTarget({
      targetTextLayer: targetLayer,
      nextTextLayer: nextLayer,
      point: { x: 40, y: 760 }
    });

    expect(result.matchedTitle).toBe(true);
    expect(result.text).toBe('BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding');
    expect(targetLayer.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)).toHaveLength(1);
    expect(nextLayer.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)).toHaveLength(1);
  });

  it('splits a single span cleanly when title is surrounded by author and venue text, and skips other columns', () => {
    const layer = createTextLayer([
      createSpan('[1] A. Smith. Single Span Title Here. ICML, 2022.', { left: 40, top: 100, width: 240, height: 12 }),
      createSpan('[10] Right Column Ref. Other Title.', { left: 340, top: 112, width: 220, height: 12 }),
      createSpan('Additional details.', { left: 40, top: 114, width: 120, height: 12 }),
      createSpan('Next paragraph after small gap.', { left: 40, top: 136, width: 180, height: 12 })
    ]);

    const result = highlightLinkTarget({
      targetTextLayer: layer,
      point: { x: 40, y: 100 }
    });

    expect(result.matchedTitle).toBe(true);
    expect(result.text).toBe('Single Span Title Here');
    expect(result.entryText).not.toContain('Right Column');
    expect(result.entryText).not.toContain('Next paragraph');
    const mark = layer.querySelector(`mark.${HIGHLIGHT_CLASS}`);
    expect(mark.textContent).toBe('Single Span Title Here');
    expect(mark.previousSibling.nodeValue).toBe('[1] A. Smith. ');
    expect(mark.nextSibling.nodeValue).toBe('. ICML, 2022.');
  });

  it('handles null/empty layers and invalid ranges gracefully', () => {
    expect(highlightLinkTarget({ targetTextLayer: null, point: { x: 0, y: 0 } }).marks).toEqual([]);
    const emptyLayer = createTextLayer([]);
    expect(highlightLinkTarget({ targetTextLayer: emptyLayer, point: { x: 0, y: 0 } }).marks).toEqual([]);
    expect(applyHighlightRange([], 0, 5)).toEqual([]);
    expect(applyHighlightRange([{ node: document.createTextNode('abc'), start: 0, end: 3, nodeStart: 0 }], 2, 2)).toEqual([]);
    clearTargetHighlights(null);
  });
});
