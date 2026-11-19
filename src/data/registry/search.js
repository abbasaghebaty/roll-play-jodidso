import { getSearchableCharacters } from './characters.js';

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u200c\u200d\s]+/g, '')
    .replace(/[\p{P}\p{S}]/gu, '');
}

// Optimal String Alignment distance: Damerau-Levenshtein with adjacent transpositions.
export function damerauLevenshtein(left, right, cutoff = Infinity) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;

  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = value;
    }
  }
  const distance = rows[a.length][b.length];
  return distance <= cutoff ? distance : cutoff + 1;
}

function maxDistanceFor(length) {
  if (length <= 4) return 1;
  if (length <= 7) return 2;
  return 3;
}

function searchableNames(character) {
  return [character.name?.fa, character.name?.en]
    .map(normalizeSearchText)
    .filter(Boolean);
}

export function searchCharacterRecords(query, records, { limit = 5, offset = 0 } = {}) {
  const normalized = normalizeSearchText(query);
  const pageSize = Math.max(1, Math.min(20, Math.floor(Number(limit) || 5)));
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  if (!normalized) return { items: [], total: 0, offset: start, limit: pageSize, hasMore: false };

  const characters = (Array.isArray(records) ? records : []).filter((item) => item.active !== false);
  const exact = (predicate, matchType) => characters
    .filter(predicate)
    .map((character) => ({ character, matchType, distance: 0 }));

  let matches = exact((item) => normalizeSearchText(item.code) === normalized, 'code');
  if (!matches.length) matches = exact((item) => normalizeSearchText(item.id) === normalized, 'id');
  if (!matches.length) matches = exact((item) => searchableNames(item).includes(normalized), 'exact');

  if (!matches.length) {
    const threshold = maxDistanceFor(Array.from(normalized).length);
    matches = [];
    for (const character of characters) {
      let distance = Infinity;
      for (const name of searchableNames(character)) {
        distance = Math.min(distance, damerauLevenshtein(normalized, name, threshold));
      }
      if (distance <= threshold) matches.push({ character, matchType: 'fuzzy', distance });
    }
    matches.sort((a, b) => a.distance - b.distance ||
      String(a.character.name?.fa || '').localeCompare(String(b.character.name?.fa || ''), 'fa'));
  }

  return {
    items: matches.slice(start, start + pageSize),
    total: matches.length,
    offset: start,
    limit: pageSize,
    hasMore: start + pageSize < matches.length,
  };
}

export function searchCharacters(query, options = {}) {
  return searchCharacterRecords(query, getSearchableCharacters(), options);
}
