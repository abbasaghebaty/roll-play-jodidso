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
    let rowMin = Infinity;
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
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > cutoff) return cutoff + 1;
  }
  return rows[a.length][b.length];
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

export function searchCharacters(query, { limit = 5 } = {}) {
  const raw = String(query ?? '').trim();
  const normalized = normalizeSearchText(raw);
  const maxResults = Math.max(1, Math.min(20, Number(limit) || 5));
  if (!normalized) return [];

  const characters = getSearchableCharacters();

  // An exact developer-assigned code always wins over all name matching.
  const exactCode = characters.filter((item) =>
    normalizeSearchText(item.code) === normalized
  );
  if (exactCode.length) return exactCode.slice(0, maxResults).map((item) => ({
    character: item, matchType: 'code', distance: 0,
  }));

  const exactId = characters.filter((item) =>
    normalizeSearchText(item.id) === normalized
  );
  if (exactId.length) return exactId.slice(0, maxResults).map((item) => ({
    character: item, matchType: 'id', distance: 0,
  }));

  const exactNames = characters.filter((item) =>
    searchableNames(item).includes(normalized)
  );
  if (exactNames.length) return exactNames.slice(0, maxResults).map((item) => ({
    character: item, matchType: 'exact', distance: 0,
  }));

  const threshold = maxDistanceFor(Array.from(normalized).length);
  const matches = [];
  for (const character of characters) {
    let distance = Infinity;
    for (const name of searchableNames(character)) {
      distance = Math.min(distance, damerauLevenshtein(normalized, name, threshold));
    }
    if (distance <= threshold) matches.push({ character, matchType: 'fuzzy', distance });
  }

  return matches
    .sort((a, b) => a.distance - b.distance ||
      a.character.name.fa.localeCompare(b.character.name.fa, 'fa'))
    .slice(0, maxResults);
}
