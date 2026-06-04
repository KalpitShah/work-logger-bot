'use strict';

/**
 * The required separator between the hours and the description, e.g.
 * "6 hours | dashboard redesign".
 */
const SEPARATOR = '|';

/**
 * Phrases that strongly indicate no work was done. When matched, hours is set
 * to 0 and the full text is used as the description. These are accepted even
 * without the "|" separator, since there is nothing to separate.
 */
const NO_WORK_PATTERNS = [
  /\bdidn'?t\s+work\b/i,
  /\bday\s*off\b/i,
  /\bdid\s+not\s+work\b/i,
  /\bno\s+work\b/i,
  /\boff\s+today\b/i,
  /\bon\s+leave\b/i,
];

/**
 * Common prefix words/phrases stripped from the start of a description.
 */
const PREFIX_PATTERNS = [
  /^worked\s+on\s+/i,
  /^working\s+on\s+/i,
  /^i\s+worked\s+on\s+/i,
  /^today\s+i\s+worked\s+on\s+/i,
  /^today\s+i\s+/i,
  /^today\s+/i,
  /^i\s+did\s+/i,
  /^i\s+/i,
  /^did\s+/i,
  /^on\s+/i,
];

/**
 * Parses the hours portion (the text before the separator). Accepts:
 *   "6", "6h", "6 h", "6hr", "6 hrs", "6 hour", "6 hours", "6.5 hours",
 *   "~6", "about 6 hours", "half day", "full day".
 *
 * Returns a number, or null if no valid hours value could be found.
 */
function parseHours(text) {
  const t = text.trim();

  if (/\bhalf\s*day\b/i.test(t)) {
    return 4;
  }
  if (/\bfull\s*day\b/i.test(t)) {
    return 8;
  }

  // A number, optionally preceded by an approximation word and optionally
  // followed by an hours unit. The unit is optional so a bare "6" works.
  const m = t.match(
    /^(?:~|about\s+|approx\.?\s+|around\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)?\.?$/i
  );
  if (m) {
    return parseFloat(m[1]);
  }

  return null;
}

/**
 * Removes leftover separator punctuation, then strips common prefix words from
 * the description.
 */
function cleanDescription(text) {
  let desc = text;

  // Remove leading/trailing separators and whitespace.
  desc = desc.replace(/^[\s,;:.\-+/&]+/, '').replace(/[\s,;:.\-+/&]+$/, '');

  // Strip a single known prefix phrase if present.
  for (const pattern of PREFIX_PATTERNS) {
    if (pattern.test(desc)) {
      desc = desc.replace(pattern, '');
      break;
    }
  }

  // Tidy again after prefix removal.
  desc = desc.replace(/^[\s,;:.\-+/&]+/, '').replace(/\s+/g, ' ').trim();

  return desc;
}

/**
 * Parses a free-text reply into structured hours + description.
 *
 * Replies must use the format "<hours> | <description>", e.g.
 * "6 hours | dashboard redesign". The hours portion accepts several spellings
 * (6, 6h, 6 hour, 6 hours, half day, full day).
 *
 * "No work" replies (e.g. "day off") are accepted without the separator and
 * recorded as 0 hours.
 *
 * @param {string} text
 * @returns {{ hours: number|null, description: string, raw: string,
 *   parsed: boolean, needsFormatHelp: boolean }}
 */
function parseReply(text) {
  const raw = typeof text === 'string' ? text : '';
  const trimmed = raw.trim();

  if (!trimmed) {
    return { hours: null, description: '', raw, parsed: false, needsFormatHelp: true };
  }

  // "Didn't work" style replies → 0 hours, full text as description.
  for (const pattern of NO_WORK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { hours: 0, description: trimmed, raw, parsed: true, needsFormatHelp: false };
    }
  }

  // The separator is required for normal replies.
  const sepIndex = trimmed.indexOf(SEPARATOR);
  if (sepIndex === -1) {
    return { hours: null, description: '', raw, parsed: false, needsFormatHelp: true };
  }

  const hoursPart = trimmed.slice(0, sepIndex);
  const descPart = trimmed.slice(sepIndex + SEPARATOR.length);

  const hours = parseHours(hoursPart);
  if (hours === null) {
    // Separator present but the hours portion wasn't understood.
    return { hours: null, description: '', raw, parsed: false, needsFormatHelp: true };
  }

  const description = cleanDescription(descPart);

  return { hours, description, raw, parsed: true, needsFormatHelp: false };
}

module.exports = { parseReply, SEPARATOR };
