import closedWordsRaw from './dehyphenate-dict/closed-words.txt?raw';
import boundSuffixesRaw from './dehyphenate-dict/bound-suffixes.txt?raw';
import compoundLeftRaw from './dehyphenate-dict/compound-left.txt?raw';
import compoundRightRaw from './dehyphenate-dict/compound-right.txt?raw';

function parseWordSet(raw) {
  return new Set(
    raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
  );
}

export const CLOSED_WORDS = parseWordSet(closedWordsRaw);
export const BOUND_SUFFIXES = parseWordSet(boundSuffixesRaw);
export const COMPOUND_LEFT = parseWordSet(compoundLeftRaw);
export const COMPOUND_RIGHT = parseWordSet(compoundRightRaw);
