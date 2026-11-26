import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_HEADER_SCAN_BYTES = 1024;
const MAX_EOF_SCAN_BYTES = 2048;
const MAX_TOTAL_INFLATED_BYTES = 20 * 1024 * 1024;
const MAX_DECOMPRESSION_RATIO = 50;
const RATIO_CHECK_MIN_BYTES = 4096;
const MAX_PAGES = 2000;

const PDF_HEADER_RE = /%PDF-(?:1\.[0-7]|2\.0)/;
const POLYGLOT_TEXT_RE = /<html|<script|<!doctype/i;

const DANGEROUS_PRIMITIVES = [
  { names: ['Encrypt'], reason: 'encrypted or password-protected PDFs are not supported' },
  { names: ['JavaScript', 'JS'], reason: 'embedded JavaScript is not allowed' },
  { names: ['Launch', 'GoToE', 'RichMedia', 'Movie', 'Sound'], reason: 'active command or media actions are not allowed' },
  { names: ['EmbeddedFile'], reason: 'embedded files are not allowed' },
  { names: ['XFA', 'SubmitForm', 'ImportData'], reason: 'dynamic form actions are not allowed' },
  { names: ['AA'], reason: 'automatic trigger actions (/AA) are not allowed' }
];

const JUNK_TITLES = new Set([
  'untitled',
  'untitled document',
  'untitled paper',
  'document',
  'paper',
  'manuscript',
  'pdf',
  'presentation',
  'powerpoint presentation',
  'slide 1',
  'noname',
  'default',
  'latex'
]);

const JUNK_TITLE_RE = /^(?:microsoft\s+(?:word|powerpoint|excel)\s*[-–—:]|word\s+document|c:\\|\/(?:users|home|tmp|var)\/)/i;
const BARE_FILENAME_RE = /^[\w.\- ]+\.(?:docx?|pptx?|xlsx?|tex|dvi|ps|pdf|rtf|txt)$/i;

export class PdfScanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PdfScanError';
    this.status = 422;
  }
}

export function normalizePdfNames(text) {
  return text.replace(/\/[^\s/<>\[\]()%]+/g, token =>
    token.replace(/#([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
  );
}

export function cleanPdfTitle(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 3) return null;
  const lower = cleaned.toLowerCase();
  if (JUNK_TITLES.has(lower)) return null;
  if (JUNK_TITLE_RE.test(cleaned)) return null;
  if (BARE_FILENAME_RE.test(cleaned)) return null;
  return cleaned.slice(0, 500);
}

function hasPdfName(text, name) {
  const re = new RegExp(`/${name}(?=[\\s/<>\\[\\]()%]|$)`);
  return re.test(text);
}

function checkPolyglotAndHeader(buffer) {
  if (!buffer.length) {
    throw new PdfScanError('The file is not a valid PDF (empty file)');
  }
  const head = buffer.subarray(0, Math.min(buffer.length, MAX_HEADER_SCAN_BYTES));
  const headLatin1 = head.toString('latin1');
  const headerMatch = PDF_HEADER_RE.exec(headLatin1);
  const pdfOffset = headerMatch ? headerMatch.index : head.length;
  const prefix = head.subarray(0, pdfOffset);

  if (
    (prefix.length >= 2 && prefix[0] === 0x4d && prefix[1] === 0x5a) || // MZ (PE/EXE)
    prefix.includes(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||          // \x7fELF
    prefix.includes(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||          // PK\x03\x04 (ZIP)
    POLYGLOT_TEXT_RE.test(prefix.toString('latin1'))
  ) {
    throw new PdfScanError('PDF rejected: suspicious polyglot or executable prefix detected');
  }

  if (!headerMatch) {
    throw new PdfScanError('The file is not a valid PDF (missing %PDF-1.x or %PDF-2.0 header)');
  }
}

function checkEofMarker(buffer) {
  const tailStart = Math.max(0, buffer.length - MAX_EOF_SCAN_BYTES);
  const tail = buffer.subarray(tailStart).toString('latin1');
  if (!tail.includes('%%EOF')) {
    throw new PdfScanError('PDF rejected: missing %%EOF marker');
  }
}

function findPrecedingDict(text, dictEndPos) {
  let depth = 0;
  for (let i = dictEndPos; i >= 1; i--) {
    if (text[i] === '>' && text[i - 1] === '>') {
      depth += 1;
      i -= 1;
    } else if (text[i] === '<' && text[i - 1] === '<') {
      depth -= 1;
      i -= 1;
      if (depth === 0) {
        return text.slice(i, dictEndPos + 1);
      }
    }
  }
  return '';
}

function parseObjStmEntries(dictNorm, inflatedStr, objMap) {
  const nMatch = /\/N\s+(\d+)/.exec(dictNorm);
  const firstMatch = /\/First\s+(\d+)/.exec(dictNorm);
  if (!nMatch || !firstMatch) return;
  const count = Number(nMatch[1]);
  const first = Number(firstMatch[1]);
  if (!Number.isFinite(count) || !Number.isFinite(first) || first > inflatedStr.length) return;
  const headerTokens = inflatedStr.slice(0, first).trim().split(/\s+/);
  const entries = [];
  for (let i = 0; i < count && i * 2 + 1 < headerTokens.length; i++) {
    const objNum = Number(headerTokens[i * 2]);
    const relOffset = Number(headerTokens[i * 2 + 1]);
    if (Number.isFinite(objNum) && Number.isFinite(relOffset)) {
      entries.push({ objNum, start: first + relOffset });
    }
  }
  for (let i = 0; i < entries.length; i++) {
    const start = entries[i].start;
    const end = i + 1 < entries.length ? entries[i + 1].start : inflatedStr.length;
    if (start >= 0 && start < end && end <= inflatedStr.length) {
      objMap.set(entries[i].objNum, normalizePdfNames(inflatedStr.slice(start, end)));
    }
  }
}

function extractStructuralText(buffer) {
  const raw = buffer.toString('latin1');
  const parts = [];
  const objStmObjects = new Map();
  const streamStartRe = />>\s*stream(?:\r\n|\n|\r)/g;
  let cursor = 0;
  let totalInflated = 0;

  while (cursor < raw.length) {
    streamStartRe.lastIndex = cursor;
    const match = streamStartRe.exec(raw);
    if (!match) {
      parts.push(raw.slice(cursor));
      break;
    }

    const dictEndPos = match.index + 1;
    const dataStart = match.index + match[0].length;
    const endstreamIdx = raw.indexOf('endstream', dataStart);
    if (endstreamIdx === -1) {
      parts.push(raw.slice(cursor));
      break;
    }

    parts.push(raw.slice(cursor, dataStart));

    const dictRaw = findPrecedingDict(raw, dictEndPos);
    const dictNorm = normalizePdfNames(dictRaw);

    if (hasPdfName(dictNorm, 'ObjStm')) {
      let dataEnd = endstreamIdx;
      while (dataEnd > dataStart && (buffer[dataEnd - 1] === 0x0a || buffer[dataEnd - 1] === 0x0d)) {
        dataEnd -= 1;
      }
      const streamBytes = buffer.subarray(dataStart, dataEnd);
      const hasFilter = hasPdfName(dictNorm, 'Filter');
      const isFlate = hasPdfName(dictNorm, 'FlateDecode') || hasPdfName(dictNorm, 'Fl');

      if (!hasFilter) {
        const str = streamBytes.toString('latin1');
        parseObjStmEntries(dictNorm, str, objStmObjects);
        parts.push(str);
      } else if (isFlate) {
        const remaining = MAX_TOTAL_INFLATED_BYTES - totalInflated;
        if (remaining <= 0) {
          throw new PdfScanError('PDF rejected: compressed object streams exceed the 20 MB safety limit');
        }
        let inflated;
        try {
          inflated = inflateSync(streamBytes, { maxOutputLength: remaining });
        } catch (error) {
          if (error?.code === 'ERR_BUFFER_TOO_LARGE') {
            throw new PdfScanError('PDF rejected: compressed object streams exceed the 20 MB safety limit');
          }
          throw new PdfScanError('PDF rejected: corrupted compressed object stream');
        }
        totalInflated += inflated.length;
        if (
          inflated.length > RATIO_CHECK_MIN_BYTES &&
          inflated.length / Math.max(1, streamBytes.length) > MAX_DECOMPRESSION_RATIO
        ) {
          throw new PdfScanError('PDF rejected: compressed object stream exceeds safe decompression ratio');
        }
        const str = inflated.toString('latin1');
        parseObjStmEntries(dictNorm, str, objStmObjects);
        parts.push(str);
      } else {
        throw new PdfScanError('PDF rejected: unsupported filter in compressed object stream');
      }
    }

    cursor = endstreamIdx + 'endstream'.length;
  }

  return { normalized: normalizePdfNames(parts.join('\n')), objStmObjects };
}

function extractInlineDict(text) {
  if (!text.startsWith('<<')) return '';
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '<' && text[i + 1] === '<') {
      depth += 1;
      i += 1;
    } else if (text[i] === '>' && text[i + 1] === '>') {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  return '';
}

function isBenignGoToAction(dictText) {
  if (!dictText.startsWith('<<')) return false;
  if (hasPdfName(dictText, 'Next')) return false;
  const actionTypeMatch = /\/S\s*\/([^\s/<>\[\]()%]+)/.exec(dictText);
  return Boolean(actionTypeMatch && actionTypeMatch[1] === 'GoTo');
}

function checkOpenAction(normalized, objStmObjects) {
  const re = /\/OpenAction(?=[\s/<>\[\]()%]|$)/g;
  let match;
  while ((match = re.exec(normalized)) !== null) {
    const after = normalized.slice(match.index + '/OpenAction'.length).trimStart();
    if (after.startsWith('[') || after.startsWith('null')) {
      continue;
    }
    if (after.startsWith('<<')) {
      if (isBenignGoToAction(extractInlineDict(after))) continue;
      throw new PdfScanError('PDF rejected: /OpenAction action dictionary is not allowed');
    }
    const refMatch = /^(\d+)\s+(\d+)\s+R\b/.exec(after);
    if (refMatch) {
      const objNum = Number(refMatch[1]);
      const objRe = new RegExp(`(?:^|[\\s\\r\\n])${refMatch[1]}\\s+${refMatch[2]}\\s+obj\\b([\\s\\S]{0,512})`);
      const objMatch = objRe.exec(normalized);
      const targetBody = objMatch
        ? objMatch[1].trimStart()
        : (objStmObjects.get(objNum) || '').trimStart();
      if (targetBody.startsWith('[')) {
        continue;
      }
      if (targetBody.startsWith('<<') && isBenignGoToAction(extractInlineDict(targetBody))) {
        continue;
      }
    }
    throw new PdfScanError('PDF rejected: /OpenAction action is not allowed');
  }
}

function checkActiveContent(normalized, objStmObjects) {
  for (const rule of DANGEROUS_PRIMITIVES) {
    for (const name of rule.names) {
      if (hasPdfName(normalized, name)) {
        throw new PdfScanError(`PDF rejected: ${rule.reason} (/${name})`);
      }
    }
  }

  if (
    (hasPdfName(normalized, 'Filespec') && hasPdfName(normalized, 'EF')) ||
    /\/EF\s*(?:<<|\d+\s+\d+\s+R\b)/.test(normalized)
  ) {
    throw new PdfScanError('PDF rejected: embedded files are not allowed (/Filespec /EF)');
  }

  checkOpenAction(normalized, objStmObjects);
}

async function verifyWithPdfJs(buffer) {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: VerbosityLevel.ERRORS
  });

  try {
    const doc = await loadingTask.promise;
    const numPages = doc.numPages;
    if (!Number.isInteger(numPages) || numPages < 1) {
      throw new PdfScanError('PDF rejected: document contains no pages');
    }
    if (numPages > MAX_PAGES) {
      throw new PdfScanError(`PDF rejected: document exceeds the ${MAX_PAGES}-page limit`);
    }
    let title = null;
    try {
      const metadata = await doc.getMetadata();
      title = cleanPdfTitle(metadata?.info?.Title);
    } catch {
      title = null;
    }
    return { numPages, title };
  } catch (error) {
    if (error instanceof PdfScanError) throw error;
    if (error?.name === 'PasswordException') {
      throw new PdfScanError('PDF rejected: encrypted or password-protected PDFs are not supported');
    }
    throw new PdfScanError('The file is not a valid PDF (failed to parse)');
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

export async function scanPdf(filePath) {
  const buffer = await readFile(filePath);
  checkPolyglotAndHeader(buffer);
  checkEofMarker(buffer);
  const { normalized, objStmObjects } = extractStructuralText(buffer);
  checkActiveContent(normalized, objStmObjects);
  return verifyWithPdfJs(buffer);
}
