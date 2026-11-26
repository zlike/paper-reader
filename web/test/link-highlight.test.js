import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_CLASS,
  applyHighlightRange,
  clearTargetHighlights,
  collectReferenceEntry,
  detectColumns,
  extractTextItems,
  extractTitleRange,
  findTargetLineIndex,
  groupItemsIntoLines,
  highlightLinkTarget,
  sanitizeTitleForSearch
} from '../src/lib/link-highlight.js';
import { dehyphenateLineWraps, shouldPreserveHyphen } from '../src/lib/dehyphenate.js';

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

  it('detects narrow ICML-style two-column gutters despite running headers and centered page numbers', () => {
    const layer = createTextLayer([
      // Full-width running header spanning both columns
      createSpan('Improving Factuality and Reasoning in Language Models through Multiagent Debate', { left: 168, top: 55, width: 382, height: 10 }),
      // Left column (~67..350)
      createSpan('Chen, Y., Arkin, J., Zhang, Y., Roy, N., and Fan, C. Scalable', { left: 67, top: 256, width: 281, height: 11 }),
      createSpan('multi-robot collaboration with large language models:', { left: 79, top: 270, width: 271, height: 11 }),
      createSpan('Centralized or decentralized systems? arXiv preprint', { left: 79, top: 285, width: 269, height: 11 }),
      createSpan('arXiv:2309.15943, 2023. 8', { left: 79, top: 299, width: 140, height: 11 }),
      // Right column (~370..653) — 19px (~2.6%) gutter!
      createSpan('Kojima, T., Gu, S. S., Reid, M., Matsuo, Y., and Iwasawa,', { left: 370, top: 285, width: 283, height: 11 }),
      createSpan('Y. Large language models are zero-shot reasoners. arXiv', { left: 381, top: 299, width: 271, height: 11 }),
      createSpan('preprint arXiv:2205.11916, 2022. 1, 5, 7', { left: 381, top: 314, width: 210, height: 11 }),
      // Centered page number sitting inside the gutter
      createSpan('10', { left: 353, top: 880, width: 12, height: 10 })
    ], { width: 736, height: 952 });

    const items = extractTextItems(layer);
    const cols = detectColumns(items, 736);
    expect(cols).not.toBeNull();
    expect(cols.splitX).toBeGreaterThan(350);
    expect(cols.splitX).toBeLessThan(370);

    const lines = groupItemsIntoLines(items, 736);
    const kojimaLine = lines.find(l => l.text.startsWith('Kojima, T.'));
    expect(kojimaLine.text).toBe('Kojima, T., Gu, S. S., Reid, M., Matsuo, Y., and Iwasawa,');
    expect(kojimaLine.columnIndex).toBe(1);
    const chenLine = lines.find(l => l.text.startsWith('Centralized or decentralized'));
    expect(chenLine.text).toBe('Centralized or decentralized systems? arXiv preprint');
    expect(chenLine.columnIndex).toBe(0);
  });

  it('does not falsely split single-column pages or non-overlapping vertical regions, and tolerates 1 overflowing item', () => {
    expect(detectColumns([], 600)).toBeNull();
    expect(detectColumns(extractTextItems(createTextLayer([
      createSpan('Only one line', { left: 60, top: 100, width: 200 })
    ], { width: 600 })), 600)).toBeNull();

    // Single-column page where lines span across the middle
    const singleColLayer = createTextLayer([
      createSpan('Line one spans across the full width of the single column page.', { left: 72, top: 100, width: 460 }),
      createSpan('Line two also spans across the full width of the single column page.', { left: 72, top: 116, width: 460 }),
      createSpan('Line three continues cleanly without any column gutter.', { left: 72, top: 132, width: 420 })
    ], { width: 600 });
    expect(detectColumns(extractTextItems(singleColLayer), 600)).toBeNull();

    // Non-overlapping Y ranges (left block at top, right block at bottom)
    const nonOverlapLayer = createTextLayer([
      createSpan('Top left text', { left: 40, top: 40, width: 150 }),
      createSpan('Top left line 2', { left: 40, top: 56, width: 150 }),
      createSpan('Bottom right signature', { left: 380, top: 400, width: 150 }),
      createSpan('Bottom right date', { left: 380, top: 416, width: 150 })
    ], { width: 600 });
    expect(detectColumns(extractTextItems(nonOverlapLayer), 600)).toBeNull();

    // Two-column page with >=10 items where 1 long URL slightly intrudes across the gutter
    const overflowSpans = [];
    for (let i = 0; i < 6; i++) {
      overflowSpans.push(createSpan(`Left line ${i}`, { left: 50, top: 100 + i * 16, width: 230, height: 11 }));
      overflowSpans.push(createSpan(`Right line ${i}`, { left: 310, top: 100 + i * 16, width: 230, height: 11 }));
    }
    overflowSpans.push(createSpan('https://very-long-url.example.org/overflow', { left: 200, top: 196, width: 140, height: 11 }));
    const overflowCols = detectColumns(extractTextItems(createTextLayer(overflowSpans, { width: 600 })), 600);
    expect(overflowCols).not.toBeNull();
  });
});

describe('findTargetLineIndex', () => {
  it('picks the closest line vertically and disambiguates two columns by X including hyperref left-margin offset', () => {
    const layer = createTextLayer([
      createSpan('[1] First reference', { left: 67, top: 100, width: 280, height: 11 }),
      createSpan('[2] Second reference', { left: 67, top: 140, width: 280, height: 11 }),
      createSpan('[10] Right column ref', { left: 370, top: 140, width: 280, height: 11 })
    ], { width: 736 });

    const lines = groupItemsIntoLines(extractTextItems(layer), 736);
    // Point slightly above [2] in left column (hyperref offset 43px -> left col 67px)
    expect(findTargetLineIndex(lines, { x: 43, y: 136 })).toBe(1);
    // Point with hyperref left-offset (x=346 is inside left col's right edge 347, but 24px left of right col 370!)
    expect(findTargetLineIndex(lines, { x: 346, y: 140 })).toBe(2);
    // Point squarely inside left column
    expect(findTargetLineIndex(lines, { x: 180, y: 140 })).toBe(1);
    // Point past right column's right edge still picks right column
    expect(findTargetLineIndex(lines, { x: 700, y: 140 })).toBe(2);
    // Point below all lines still picks closest
    expect(findTargetLineIndex(lines, { x: 67, y: 200 })).toBe(1);
    // Non-finite point defaults to (0, 0)
    expect(findTargetLineIndex(lines, {})).toBe(0);
  });

  it('prefers the first reference below a References section heading when destination Y is below the heading', () => {
    const layer = createTextLayer([
      createSpan('References', { left: 67, top: 82, width: 70, height: 12 }),
      createSpan('Alayrac, J.-B. et al. Flamingo. NeurIPS, 2022.', { left: 67, top: 106, width: 280, height: 11 })
    ], { width: 600 });

    const lines = groupItemsIntoLines(extractTextItems(layer), 600);
    expect(findTargetLineIndex(lines, { x: 43, y: 100 })).toBe(1);
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

  it('continues a wrapped reference from left column bottom to right column top, but stops for a new right-column reference', () => {
    // Wrapped reference across columns (with overlapping column content above)
    const wrapLayer = createTextLayer([
      createSpan('Earlier, E. Prior Paper. 2023.', { left: 60, top: 80, width: 200, height: 12 }),
      createSpan('Author, A. First Half of a', { left: 60, top: 740, width: 200, height: 12 }),
      createSpan('Very Long Wrapped', { left: 72, top: 754, width: 180, height: 12 }),
      createSpan('Title Here. ICML, 2024.', { left: 382, top: 80, width: 180, height: 12 }),
      createSpan('Next, B. Another Paper. 2024.', { left: 370, top: 108, width: 200, height: 12 })
    ], { width: 736 });
    const wrapLines = groupItemsIntoLines(extractTextItems(wrapLayer, 0), 736);
    const wrapStart = wrapLines.findIndex(l => l.text.startsWith('Author, A.'));
    const wrapEntry = collectReferenceEntry(wrapLines, wrapStart);
    expect(wrapEntry.text).toBe('Author, A. First Half of a Very Long Wrapped Title Here. ICML, 2024.');

    // Complete left-column reference followed by a new hanging-indent reference at top of right column
    const separateLayer = createTextLayer([
      createSpan('Earlier, E. Prior Paper. 2023.', { left: 60, top: 80, width: 200, height: 12 }),
      createSpan('Hong, S., et al. Metagpt. arXiv, 2023.', { left: 60, top: 740, width: 240, height: 12 }),
      createSpan('Irving, G., and Amodei, D. AI safety via', { left: 370, top: 80, width: 240, height: 12 }),
      createSpan('debate. arXiv, 2018.', { left: 382, top: 94, width: 160, height: 12 })
    ], { width: 736 });
    const sepLines = groupItemsIntoLines(extractTextItems(separateLayer, 0), 736);
    const sepStart = sepLines.findIndex(l => l.text.startsWith('Hong, S.'));
    const sepEntry = collectReferenceEntry(sepLines, sepStart);
    expect(sepEntry.text).toBe('Hong, S., et al. Metagpt. arXiv, 2023.');
    expect(sepEntry.text).not.toContain('Irving');
  });

  it('continues across a page footer number onto the next page first column, and does not treat a wrapped year as a new reference', () => {
    const targetLayer = createTextLayer([
      createSpan('Shunyu Yao, Dian Yu, and Karthik Narasimhan.', { left: 72, top: 740, width: 320, height: 12 }),
      createSpan('2023. Tree of Thoughts: Deliberate Problem', { left: 84, top: 754, width: 300, height: 12 }),
      createSpan('10', { left: 290, top: 780, width: 16, height: 10 })
    ], { width: 600 });
    const nextLayer = createTextLayer([
      createSpan('Solving with Large Language Models. NeurIPS.', { left: 84, top: 60, width: 300, height: 12 })
    ], { width: 600 });

    const targetLines = groupItemsIntoLines(extractTextItems(targetLayer, 0), 600);
    const nextLines = groupItemsIntoLines(extractTextItems(nextLayer, 1), 600);
    const entry = collectReferenceEntry(targetLines, 0, nextLines);
    expect(entry.text).toBe(
      'Shunyu Yao, Dian Yu, and Karthik Narasimhan. 2023. Tree of Thoughts: Deliberate Problem Solving with Large Language Models. NeurIPS.'
    );

    // Complete entry at bottom of page stops before a new "Last, F." entry on a multi-column next page
    const completePage = createTextLayer([
      createSpan('Liu, H., and Abbeel, P. Instruction agents. arXiv, 2022. 8', { left: 72, top: 740, width: 300, height: 12 })
    ], { width: 600 });
    const nextMultiCol = createTextLayer([
      createSpan('Liu, N., and Du, Y. Compositional generation. arXiv, 2022.', { left: 60, top: 80, width: 220, height: 12 }),
      createSpan('Shinn, N., and Gopinath, A. Reflexion. arXiv, 2023.', { left: 360, top: 80, width: 220, height: 12 })
    ], { width: 736 });
    const stopEntry = collectReferenceEntry(
      groupItemsIntoLines(extractTextItems(completePage, 0), 600),
      0,
      groupItemsIntoLines(extractTextItems(nextMultiCol, 1), 736)
    );
    expect(stopEntry.lines).toHaveLength(1);
    expect(stopEntry.text).not.toContain('Liu, N.');
  });
});

describe('extractTitleRange', () => {
  const slice = (text, range) => (range ? text.slice(range.start, range.end) : null);

  it('extracts quoted titles (straight, curly, and LaTeX quotes) without matching inline quotes inside titles', () => {
    const s1 = '[1] A. Vaswani et al., "Attention Is All You Need," in NeurIPS, 2017.';
    expect(slice(s1, extractTitleRange(s1))).toBe('Attention Is All You Need');

    const s2 = '[2] J. Smith. “Deep Learning for Everyone.” Nature, 2021.';
    expect(slice(s2, extractTitleRange(s2))).toBe('Deep Learning for Everyone');

    const s3 = "[3] K. He et al. ``Deep Residual Learning for Image Recognition,'' CVPR 2016.";
    expect(slice(s3, extractTitleRange(s3))).toBe('Deep Residual Learning for Image Recognition');

    const s4 = 'Li, G., and Ghanem, B. Camel: Communicative agents for" mind" exploration of large language model society. NeurIPS, 2024.';
    expect(slice(s4, extractTitleRange(s4))).toBe(
      'Camel: Communicative agents for" mind" exploration of large language model society'
    );
  });

  it('extracts titles from Last, F. author-dot bibliographies including multi-initials, hyphenated initials, and surname particles', () => {
    const kojima = 'Kojima, T., Gu, S. S., Reid, M., Matsuo, Y., and Iwasawa, Y. Large language models are zero-shot reasoners. arXiv preprint arXiv:2205.11916, 2022. 1, 5, 7';
    expect(slice(kojima, extractTitleRange(kojima))).toBe('Large language models are zero-shot reasoners');

    const guu = 'Guu, K., Lee, K., and Chang, M.- W. REALM: Retrieval-augmented language model pre-training. arXiv preprint arXiv:2002.08909, 2020. 8';
    expect(slice(guu, extractTitleRange(guu))).toBe('REALM: Retrieval-augmented language model pre-training');

    const minsky = 'Minsky, M. Society of mind. Simon and Schuster, 1988. 1';
    expect(slice(minsky, extractTitleRange(minsky))).toBe('Society of mind');

    const lamda = '[28] R. Thoppilan, D. De Freitas, J. Hall, and G. Irv- ing. Lamda: Language models for dialog applications. arXiv, 2022.';
    expect(slice(lamda, extractTitleRange(lamda))).toBe('Lamda: Language models for dialog applications');
  });

  it('handles titles with question/exclamation marks, web dates, and trailing venue/URL cues', () => {
    const chen = 'Chen, Y., Arkin, J., and Fan, C. Scalable multi-robot collaboration: Centralized or decentralized systems? arXiv preprint arXiv:2309.15943, 2023. 8';
    expect(slice(chen, extractTitleRange(chen))).toBe('Scalable multi-robot collaboration: Centralized or decentralized systems?');

    const rajani = 'Rajani, N. F., and Socher, R. Explain yourself! leveraging language models for commonsense reasoning. arXiv preprint arXiv:1906.02361, 2019. 7';
    expect(slice(rajani, extractTitleRange(rajani))).toBe('Explain yourself! leveraging language models for commonsense reasoning');

    const wt5 = 'Sharan Narang, Colin Raffel, and Karishma Malkan. 2020. WT5?! Training text-to-text models to explain their predictions. arXiv preprint.';
    expect(slice(wt5, extractTitleRange(wt5))).toBe('WT5?! Training text-to-text models to explain their predictions');

    const openai = 'OpenAI. Chatgpt: Optimizing language models for dialogue, Dec 2022. URL https://openai.com/blog/chatgpt/. 1, 5';
    expect(slice(openai, extractTitleRange(openai))).toBe('Chatgpt: Optimizing language models for dialogue');

    const noPeriodArxiv = 'Smith, J. Zero-Shot Reasoning with Prompts arXiv:2205.11916';
    expect(slice(noPeriodArxiv, extractTitleRange(noPeriodArxiv))).toBe('Zero-Shot Reasoning with Prompts');

    const withBackref = 'Smith, J. Can Language Models Reason? 1, 5, 7';
    expect(slice(withBackref, extractTitleRange(withBackref))).toBe('Can Language Models Reason?');
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

  it('reproduces Du et al. Page 10 two-column Kojima citation and highlights only the exact title with zero cross-column bleed', () => {
    const layer = createTextLayer([
      createSpan('Improving Factuality and Reasoning in Language Models', { left: 168, top: 55, width: 382, height: 10 }),
      createSpan('Chen, Y., Arkin, J., Zhang, Y., Roy, N., and Fan, C. Scalable', { left: 67, top: 256, width: 281, height: 11 }),
      createSpan('multi-robot collaboration with large language models:', { left: 79, top: 270, width: 271, height: 11 }),
      createSpan('Centralized or decentralized systems? ', { left: 79, top: 285, width: 198, height: 11 }),
      createSpan('arXiv preprint', { left: 277, top: 285, width: 71, height: 11 }),
      createSpan('arXiv:2309.15943, 2023. 8', { left: 79, top: 299, width: 140, height: 11 }),
      createSpan('Kojima, T., Gu, S. S., Reid, M., Matsuo, Y., and Iwasawa,', { left: 370, top: 295, width: 283, height: 11 }),
      createSpan('Y. Large language models are zero-shot reasoners. arXiv', { left: 381, top: 310, width: 271, height: 11 }),
      createSpan('preprint arXiv:2205.11916, 2022. 1, 5, 7', { left: 381, top: 324, width: 210, height: 11 }),
      createSpan('10', { left: 353, top: 880, width: 12, height: 10 })
    ], { width: 736, height: 952 });

    const result = highlightLinkTarget({
      targetTextLayer: layer,
      point: { x: 345.8, y: 291.2 }
    });

    expect(result.matchedTitle).toBe(true);
    expect(result.text).toBe('Large language models are zero-shot reasoners');
    expect(result.entryText).not.toContain('Centralized');
    expect(result.entryText).not.toContain('2309.15943');
    const marks = layer.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`);
    expect(Array.from(marks).map(m => m.textContent).join('')).toBe('Large language models are zero-shot reasoners');
  });

  it('handles null/empty layers and invalid ranges gracefully', () => {
    expect(highlightLinkTarget({ targetTextLayer: null, point: { x: 0, y: 0 } })).toEqual({
      marks: [],
      text: '',
      entryText: '',
      matchedTitle: false,
      searchTitle: ''
    });
    const emptyLayer = createTextLayer([]);
    expect(highlightLinkTarget({ targetTextLayer: emptyLayer, point: { x: 0, y: 0 } })).toEqual({
      marks: [],
      text: '',
      entryText: '',
      matchedTitle: false,
      searchTitle: ''
    });
    expect(applyHighlightRange([], 0, 5)).toEqual([]);
    expect(applyHighlightRange([{ node: document.createTextNode('abc'), start: 0, end: 3, nodeStart: 0 }], 2, 2)).toEqual([]);
    clearTargetHighlights(null);
  });

  it('returns sanitized searchTitle preserving compound hyphens and joining split words across line wraps', () => {
    const layer = createTextLayer([
      createSpan('[1] J. Researcher. Trans—', { left: 40, top: 200, width: 160, height: 12 }),
      createSpan('formers for Self–', { left: 56, top: 216, width: 140, height: 12 }),
      createSpan('Feedback Multi–', { left: 56, top: 232, width: 140, height: 12 }),
      createSpan('agent Systems. NeurIPS, 2024.', { left: 56, top: 248, width: 180, height: 12 })
    ]);

    const result = highlightLinkTarget({
      targetTextLayer: layer,
      point: { x: 40, y: 200 }
    });

    expect(result.matchedTitle).toBe(true);
    expect(result.text).toBe('Trans— formers for Self– Feedback Multi– agent Systems');
    expect(result.searchTitle).toBe('Transformers for Self-Feedback Multi-agent Systems');
  });
});

describe('sanitizeTitleForSearch & word-aware dehyphenation', () => {
  it('returns empty string for empty, whitespace, or non-string inputs', () => {
    expect(sanitizeTitleForSearch('')).toBe('');
    expect(sanitizeTitleForSearch('   \t\n  ')).toBe('');
    expect(sanitizeTitleForSearch(null)).toBe('');
    expect(sanitizeTitleForSearch(undefined)).toBe('');
  });

  it('joins single words split across PDF line wraps with hyphens, en-dashes, em-dashes, and soft hyphens', () => {
    expect(sanitizeTitleForSearch('Trans- formers for Everyone')).toBe('Transformers for Everyone');
    expect(sanitizeTitleForSearch('Trans-\nformers for Everyone')).toBe('Transformers for Everyone');
    expect(sanitizeTitleForSearch('Reflexion: an au- tonomous agent')).toBe('Reflexion: an autonomous agent');
    expect(sanitizeTitleForSearch('Retrieving in- formation for di- alogue')).toBe('Retrieving information for dialogue');
    expect(sanitizeTitleForSearch('Ex- plain yourself! common- sense reasoning')).toBe('Explain yourself! commonsense reasoning');
    expect(sanitizeTitleForSearch('Emergent capabil- ities and prompt- ing')).toBe('Emergent capabilities and prompting');
    expect(sanitizeTitleForSearch('Collab\u00AD oration in \u00ADModels')).toBe('Collaboration in Models');
  });

  it('preserves compound hyphens across PDF line wraps (issue #20)', () => {
    expect(sanitizeTitleForSearch('Self-Refine: Iterative Refinement with Self-\nFeedback')).toBe('Self-Refine: Iterative Refinement with Self-Feedback');
    expect(sanitizeTitleForSearch('Self-Refine: Iterative Refinement with Self–\nFeedback')).toBe('Self-Refine: Iterative Refinement with Self-Feedback');
    expect(sanitizeTitleForSearch('Multi– agent Debate')).toBe('Multi-agent Debate');
    expect(sanitizeTitleForSearch('Multi–\nagent Debate')).toBe('Multi-agent Debate');
    expect(sanitizeTitleForSearch('Multi—\r\n  agent Debate')).toBe('Multi-agent Debate');
    expect(sanitizeTitleForSearch('Chain-of- thought prompting')).toBe('Chain-of-thought prompting');
    expect(sanitizeTitleForSearch('End-to- end and Text-to- image models')).toBe('End-to-end and Text-to-image models');
    expect(sanitizeTitleForSearch('GPT- 4, LLaMA- 2, and 3D- aware agents')).toBe('GPT-4, LLaMA-2, and 3D-aware agents');
    expect(sanitizeTitleForSearch('e- snli and n- gram benchmarks')).toBe('e-snli and n-gram benchmarks');
    expect(sanitizeTitleForSearch('a- b- c')).toBe('a-b-c');
    expect(sanitizeTitleForSearch('Multiple- Choice and Human- AI evaluation')).toBe('Multiple-Choice and Human-AI evaluation');
    expect(sanitizeTitleForSearch('self-feed- back loop')).toBe('self-feedback loop');
  });

  it('removes inline/spaced en-dashes and em-dashes while preserving normal inline hyphens and collapsing whitespace', () => {
    expect(sanitizeTitleForSearch('Scaling Laws — A Comprehensive Survey')).toBe('Scaling Laws A Comprehensive Survey');
    expect(sanitizeTitleForSearch('Encoder–Decoder   Architecture  –  Revisited')).toBe('Encoder Decoder Architecture Revisited');
    expect(sanitizeTitleForSearch('Large language models are zero-shot reasoners')).toBe('Large language models are zero-shot reasoners');
    expect(sanitizeTitleForSearch('  State-of-the-Art   Methods - Overview  ')).toBe('State-of-the-Art Methods - Overview');
  });

  it('handles direct shouldPreserveHyphen and dehyphenateLineWraps edge cases', () => {
    expect(dehyphenateLineWraps('')).toBe('');
    expect(dehyphenateLineWraps(null)).toBe('');
    expect(shouldPreserveHyphen('', 'test')).toBe(false);
    expect(shouldPreserveHyphen('test', '')).toBe(false);
    // Bound suffix joining (e.g. "visual- izations", "learn- ers")
    expect(shouldPreserveHyphen('visual', 'izations')).toBe(false);
    expect(shouldPreserveHyphen('learn', 'ers')).toBe(false);
    // Capitalized proper-noun compound right half vs ALL-CAPS split
    expect(shouldPreserveHyphen('Multi', 'FooBar')).toBe(true);
    expect(shouldPreserveHyphen('MULTI', 'FOOBAR')).toBe(false);
  });
});
