'use strict';

/**
 * Phrases that strongly indicate no work was done. When matched, hours is set
 * to 0 and the full text is used as the description.
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
 * Attempts to extract a number of hours from free text.
 * Returns { hours, matchRange } where matchRange is [start, end) of the
 * substring consumed (so it can be removed from the description), or null.
 */
function extractHours(text) {
  // 1. Word-based shortcuts.
  if (/\bhalf\s*day\b/i.test(text)) {
    const m = text.match(/\bhalf\s*day\b/i);
    return { hours: 4, matchRange: [m.index, m.index + m[0].length] };
  }
  if (/\bfull\s*day\b/i.test(text)) {
    const m = text.match(/\bfull\s*day\b/i);
    return { hours: 8, matchRange: [m.index, m.index + m[0].length] };
  }

  // 2. Numeric patterns with an explicit hours unit, e.g. "6.5 hours", "6hrs",
  //    "6h". Ranges like "6-7 hours" take the first number.
  const unitRegex = /(~|about\s+|approx\.?\s+|around\s+)?(\d+(?:\.\d+)?)\s*(?:-\s*\d+(?:\.\d+)?\s*)?(?:hours?|hrs?|h)\b/i;
  const unitMatch = text.match(unitRegex);
  if (unitMatch) {
    return {
      hours: parseFloat(unitMatch[2]),
      matchRange: [unitMatch.index, unitMatch.index + unitMatch[0].length],
    };
  }

  // 3. Approximate numbers without a unit, e.g. "~6", "about 6", "around 6".
  const approxRegex = /(~|about\s+|approx\.?\s+|around\s+)(\d+(?:\.\d+)?)/i;
  const approxMatch = text.match(approxRegex);
  if (approxMatch) {
    return {
      hours: parseFloat(approxMatch[2]),
      matchRange: [approxMatch.index, approxMatch.index + approxMatch[0].length],
    };
  }

  // 4. A bare leading number, e.g. "6, dashboard work" or "6 dashboard redesign".
  const leadingRegex = /^\s*(\d+(?:\.\d+)?)\b/;
  const leadingMatch = text.match(leadingRegex);
  if (leadingMatch) {
    return {
      hours: parseFloat(leadingMatch[1]),
      matchRange: [leadingMatch.index, leadingMatch.index + leadingMatch[0].length],
    };
  }

  return null;
}

/**
 * Removes leftover separator punctuation and stray "hours" wording, then strips
 * common prefix words from the description.
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
 * @param {string} text
 * @returns {{ hours: number|null, description: string, raw: string, parsed: boolean }}
 */
function parseReply(text) {
  const raw = typeof text === 'string' ? text : '';
  const trimmed = raw.trim();

  if (!trimmed) {
    return { hours: null, description: '', raw, parsed: false };
  }

  // "Didn't work" style replies → 0 hours, full text as description.
  for (const pattern of NO_WORK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { hours: 0, description: trimmed, raw, parsed: true };
    }
  }

  const hoursResult = extractHours(trimmed);

  if (!hoursResult) {
    // Could not determine hours — keep the text as description for context.
    return { hours: null, description: trimmed, raw, parsed: false };
  }

  // Remove the consumed hours substring to build the description.
  const [start, end] = hoursResult.matchRange;
  const remainder = (trimmed.slice(0, start) + ' ' + trimmed.slice(end)).trim();
  const description = cleanDescription(remainder);

  return {
    hours: hoursResult.hours,
    description,
    raw,
    parsed: true,
  };
}

module.exports = { parseReply };
