import {
  CLOSED_WORDS,
  BOUND_SUFFIXES,
  COMPOUND_LEFT,
  COMPOUND_RIGHT
} from './dehyphenate-dict.js';

/**
 * Word-aware PDF line-wrap dehyphenation shared between frontend title
 * sanitization and backend citation query normalization.
 */

const LINE_WRAP_HYPHEN_RE = /([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)([\-\u2010\u2011\u2012\u2013\u2014])\s+([\p{L}\p{N}]+)/u;

/**
 * Decide whether a line-wrap dash between `left` and `right` represents a true
 * compound hyphen that should be preserved (`true`) or an editorial line-break
 * hyphen that should be removed to rejoin a split word (`false`).
 */
export function shouldPreserveHyphen(left, right) {
  if (!left || !right) return false;

  const lastPart = left.includes('-') ? left.slice(left.lastIndexOf('-') + 1) : left;
  const lastLower = lastPart.toLowerCase();
  const rightLower = right.toLowerCase();
  const joinedLower = lastLower + rightLower;

  // 1. Known closed word (e.g. "in- formation" -> "information", "common- sense" -> "commonsense")
  if (CLOSED_WORDS.has(joinedLower)) return false;

  // 2. Chained compounds (e.g. "Chain-of- thought", "End-to- end", "Zero-shot- CoT", "off-the- shelf")
  if (left.includes('-')) return true;

  // 3. Numeric or version compounds (e.g. "GPT- 4", "LLaMA- 2", "3D- aware", "12- mile")
  if (/\d/.test(left) || /\d/.test(right)) return true;

  // 4. Single-letter prefixes (LaTeX \lefthyphenmin=2 never breaks after 1 letter: "e- snli", "n- gram")
  if (left.length === 1 && /^\p{L}$/u.test(left)) return true;

  // 5. Bound morphological suffix on right (e.g. "prompt- ing", "learn- ers", "visual- izations")
  if (BOUND_SUFFIXES.has(rightLower) && !COMPOUND_RIGHT.has(rightLower)) return false;

  // 6. Both halves are valid compound parts / words (e.g. "self- feedback", "few- shot", "multi- robot")
  const leftValid = COMPOUND_LEFT.has(lastLower) || CLOSED_WORDS.has(lastLower);
  const rightValid = COMPOUND_RIGHT.has(rightLower) || CLOSED_WORDS.has(rightLower);
  if (leftValid && rightValid) return true;

  // 7. Capitalized compound right half when left is a known word (e.g. "Multiple- Choice", "Human- AI")
  if (leftValid && /^[A-Z]/.test(right) && right.length >= 2 && !/^[A-Z]+$/.test(left)) {
    return true;
  }

  return false;
}

/**
 * Resolve PDF line-wrap hyphens and soft hyphens in `text` while preserving
 * compound hyphens and leaving punctuation/structure intact.
 */
export function dehyphenateLineWraps(text) {
  if (!text || typeof text !== 'string') return '';
  let result = text.replace(/\u00AD\s*/g, '');

  // Iteratively resolve line-wrap hyphens so chained wraps (e.g. "Chain- of- thought")
  // accumulate the full left-hand compound token.
  let safety = 0;
  while (safety++ < 200) {
    let changed = false;
    result = result.replace(LINE_WRAP_HYPHEN_RE, (_match, left, _dash, right) => {
      changed = true;
      return shouldPreserveHyphen(left, right) ? `${left}-${right}` : `${left}${right}`;
    });
    if (!changed) break;
  }

  return result;
}

/**
 * Clean a raw PDF-extracted title for academic search queries.
 * Preserves compound hyphens across line wraps, joins split words, removes soft
 * hyphens, normalizes standalone/separator en- and em-dashes to spaces, and
 * collapses whitespace.
 */
export function sanitizeTitleForSearch(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  return dehyphenateLineWraps(rawTitle)
    // Normalize remaining en-dashes and em-dashes (e.g. separators) to spaces
    .replace(/[\u2013\u2014]+/g, ' ')
    // Collapse and trim whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
