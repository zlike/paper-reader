import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dictDir = import.meta.url.startsWith('file:')
  ? path.join(path.dirname(fileURLToPath(import.meta.url)), 'dehyphenate-dict')
  : path.resolve(process.cwd(), 'web/src/lib/dehyphenate-dict');

function loadWordSet(filename) {
  const raw = fs.readFileSync(path.join(dictDir, filename), 'utf8');
  return new Set(
    raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
  );
}

export const CLOSED_WORDS = loadWordSet('closed-words.txt');
export const BOUND_SUFFIXES = loadWordSet('bound-suffixes.txt');
export const COMPOUND_LEFT = loadWordSet('compound-left.txt');
export const COMPOUND_RIGHT = loadWordSet('compound-right.txt');
