#!/usr/bin/env node
/**
 * Opt-in real-paper link preview highlighting accuracy benchmark.
 *
 * Fetches and caches 7 real academic PDFs (Du et al. ICML 2024 2-col & arXiv 1-col,
 * plus 5 papers referenced inside Du et al.) into os.tmpdir() (never committed to git),
 * resolves every internal citation link across each paper, runs highlightLinkTarget(),
 * and verifies >= 95% accuracy per paper and overall.
 *
 * Usage:
 *   npm run benchmark:highlight
 *   node scripts/benchmark-highlight.mjs --verbose --threshold=95
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  resolveDestination,
  computePreviewTarget,
  isSupportedLink
} from '../web/src/lib/pdf-links.js';
import { highlightLinkTarget } from '../web/src/lib/link-highlight.js';

const PAPERS = [
  {
    id: 'du-icml2024',
    name: 'Du et al. (ICML 2024, 2-col)',
    url: 'https://raw.githubusercontent.com/mlresearch/v235/main/assets/du24e/du24e.pdf'
  },
  {
    id: 'du-arxiv',
    name: 'Du et al. (arXiv:2305.14325, 1-col)',
    url: 'https://arxiv.org/pdf/2305.14325.pdf'
  },
  {
    id: 'kojima-2205.11916',
    name: 'Kojima et al. (arXiv:2205.11916)',
    url: 'https://arxiv.org/pdf/2205.11916.pdf'
  },
  {
    id: 'wei-2201.11903',
    name: 'Wei et al. (arXiv:2201.11903)',
    url: 'https://arxiv.org/pdf/2201.11903.pdf'
  },
  {
    id: 'wang-2203.11171',
    name: 'Wang et al. (arXiv:2203.11171)',
    url: 'https://arxiv.org/pdf/2203.11171.pdf'
  },
  {
    id: 'liang-2305.19118',
    name: 'Liang et al. (arXiv:2305.19118, 2-col)',
    url: 'https://arxiv.org/pdf/2305.19118.pdf'
  },
  {
    id: 'chan-2308.07201',
    name: 'Chan et al. (arXiv:2308.07201)',
    url: 'https://arxiv.org/pdf/2308.07201.pdf'
  }
];

const SCALE = 1.2;
const CACHE_DIR =
  process.env.BENCHMARK_CACHE_DIR || path.join(os.tmpdir(), 'paper-reader-highlight-benchmark');

function parseArgs(argv) {
  let verbose = false;
  let threshold = Number(process.env.BENCHMARK_THRESHOLD || 95);
  for (const arg of argv) {
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg.startsWith('--threshold=')) {
      const parsed = Number(arg.slice('--threshold='.length));
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 100) {
        threshold = parsed;
      }
    }
  }
  return { verbose, threshold };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureCachedPdf(paper) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const filePath = path.join(CACHE_DIR, `${paper.id}.pdf`);
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 10_000) return filePath;
  } catch {
    // Not cached yet
  }

  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(paper.url, {
        headers: { 'User-Agent': 'paper-reader-benchmark/1.0' }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 4).toString('ascii') !== '%PDF') {
        throw new Error('Response is not a valid PDF');
      }
      await fs.writeFile(filePath, buf);
      return filePath;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(attempt === 1 ? 2000 : 5000);
      }
    }
  }
  throw new Error(`Failed to fetch ${paper.name} (${paper.url}) after ${maxAttempts} attempts: ${lastErr?.message || lastErr}`);
}

function buildTextLayer(doc, viewport, textContent) {
  const layer = doc.createElement('div');
  layer.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: viewport.width,
    bottom: viewport.height,
    width: viewport.width,
    height: viewport.height
  });

  for (const item of textContent.items) {
    if (!item.str) continue;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 10;
    const left = tx[4];
    const top = tx[5] - fontHeight;
    const width = Math.max(1, (item.width || 0) * viewport.scale);
    const height = Math.max(1, fontHeight);

    const span = doc.createElement('span');
    span.textContent = item.str;
    span.getBoundingClientRect = () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height
    });
    layer.appendChild(span);
  }

  return layer;
}

function isCitationDestination(dest) {
  if (typeof dest === 'string') {
    return /^cite\./i.test(dest);
  }
  return false;
}

function isValidTitleHighlight(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 5) return { ok: false, reason: 'too short' };
  if (/^(?:arXiv|Proceedings|Advances in|In\s+(?:Proceedings|International|Advances|Annual|Conference|NeurIPS|ICML|ICLR|EMNLP|ACL|CVPR)|URL\s+http|https?:\/\/)/i.test(t)) {
    return { ok: false, reason: 'starts with venue/URL' };
  }
  if (/^[A-Z][a-z]+,\s+[A-Z]\.(?:,|\s+[A-Z]\.)/.test(t)) {
    return { ok: false, reason: 'starts with author list (Last, F.)' };
  }
  if (/^References\b/i.test(t)) {
    return { ok: false, reason: 'highlighted section heading' };
  }
  if (/\barXiv\s+preprint\b/i.test(t) && !/preprint/i.test(t.replace(/arXiv\s+preprint/gi, ''))) {
    return { ok: false, reason: 'contains arXiv preprint metadata' };
  }
  if (/\b(?:et\s+al\.,?\s*\d{4}|Proceedings of the \d+)/i.test(t)) {
    return { ok: false, reason: 'contains citation/venue metadata' };
  }
  return { ok: true };
}

async function benchmarkPaper(paper, { verbose }) {
  const filePath = await ensureCachedPdf(paper);
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await pdfjs.getDocument({ data, verbosity: 0 }).promise;

  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;

  const pageLayerCache = new Map();
  async function getPageLayer(pageNumber) {
    if (pageLayerCache.has(pageNumber)) return pageLayerCache.get(pageNumber);
    if (pageNumber < 1 || pageNumber > pdf.numPages) return null;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: SCALE });
    const textContent = await page.getTextContent();
    const layer = buildTextLayer(dom.window.document, viewport, textContent);
    const entry = { page, viewport, layer };
    pageLayerCache.set(pageNumber, entry);
    return entry;
  }

  let totalLinks = 0;
  let passedLinks = 0;
  let page1Total = 0;
  let page1Passed = 0;
  const uniqueResults = new Map();
  const failures = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const annotations = await page.getAnnotations();

    for (const annot of annotations) {
      if (!isSupportedLink(annot) || annot.url || annot.unsafeUrl) continue;
      if (!isCitationDestination(annot.dest)) continue;

      const resolved = await resolveDestination(pdf, annot.dest);
      if (!resolved) continue;

      const targetInfo = await getPageLayer(resolved.pageNumber);
      if (!targetInfo) continue;

      const preview = computePreviewTarget(
        targetInfo.page,
        targetInfo.viewport,
        resolved.destination,
        resolved.pageNumber,
        pdf.numPages
      );
      const nextInfo = preview.includeNextPage
        ? await getPageLayer(resolved.pageNumber + 1)
        : null;

      const result = highlightLinkTarget({
        targetTextLayer: targetInfo.layer,
        nextTextLayer: nextInfo?.layer || null,
        point: { x: preview.x, y: preview.y }
      });
      const text = (result?.text || '').replace(/\s+/g, ' ').trim();

      const check = isValidTitleHighlight(text);
      totalLinks++;
      if (check.ok) passedLinks++;
      if (pageNum === 1) {
        page1Total++;
        if (check.ok) page1Passed++;
      }

      if (!uniqueResults.has(annot.dest)) {
        uniqueResults.set(annot.dest, { ok: check.ok, text, reason: check.reason });
        if (!check.ok) {
          failures.push({ dest: annot.dest, page: resolved.pageNumber, text, reason: check.reason });
        }
      }
    }
  }

  await pdf.destroy();

  const uniqueTotal = uniqueResults.size;
  const uniquePassed = [...uniqueResults.values()].filter(r => r.ok).length;
  const accuracy = totalLinks > 0 ? (passedLinks / totalLinks) * 100 : 100;

  if (verbose && failures.length > 0) {
    for (const f of failures.slice(0, 10)) {
      console.log(`    FAIL [${f.dest}] (p.${f.page}): ${f.reason} -> "${f.text}"`);
    }
  }

  return {
    paper,
    totalLinks,
    passedLinks,
    uniqueTotal,
    uniquePassed,
    page1Total,
    page1Passed,
    accuracy,
    failures
  };
}

async function main() {
  const { verbose, threshold } = parseArgs(process.argv.slice(2));
  console.log(`Link preview highlighting benchmark (threshold: >= ${threshold}%, cache: ${CACHE_DIR})\n`);

  const results = [];
  for (const paper of PAPERS) {
    const res = await benchmarkPaper(paper, { verbose });
    results.push(res);
    const pct = res.accuracy.toFixed(1);
    const uniquePct = res.uniqueTotal > 0 ? ((res.uniquePassed / res.uniqueTotal) * 100).toFixed(1) : '100.0';
    console.log(
      `${paper.name}\n` +
      `  All links: ${res.passedLinks}/${res.totalLinks} (${pct}%) | ` +
      `Unique: ${res.uniquePassed}/${res.uniqueTotal} (${uniquePct}%) | ` +
      `Page 1: ${res.page1Passed}/${res.page1Total}`
    );
  }

  const grandTotal = results.reduce((sum, r) => sum + r.totalLinks, 0);
  const grandPassed = results.reduce((sum, r) => sum + r.passedLinks, 0);
  const grandUniqueTotal = results.reduce((sum, r) => sum + r.uniqueTotal, 0);
  const grandUniquePassed = results.reduce((sum, r) => sum + r.uniquePassed, 0);
  const overallAccuracy = grandTotal > 0 ? (grandPassed / grandTotal) * 100 : 0;
  const uniqueAccuracy = grandUniqueTotal > 0 ? (grandUniquePassed / grandUniqueTotal) * 100 : 0;

  console.log(
    `\n=== OVERALL ACROSS ${results.length} PAPERS ===\n` +
    `All links: ${grandPassed}/${grandTotal} (${overallAccuracy.toFixed(1)}%)\n` +
    `Unique refs: ${grandUniquePassed}/${grandUniqueTotal} (${uniqueAccuracy.toFixed(1)}%)`
  );

  const failedPapers = results.filter(r => r.accuracy < threshold);
  if (overallAccuracy < threshold || failedPapers.length > 0) {
    console.error(
      `\nFAIL: Accuracy below ${threshold}% threshold ` +
      `(overall=${overallAccuracy.toFixed(1)}%, failed papers=${failedPapers.map(r => r.paper.id).join(', ') || 'none'})`
    );
    process.exit(1);
  }

  console.log(`\nPASS: All ${results.length} papers and overall accuracy meet >= ${threshold}% threshold.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
