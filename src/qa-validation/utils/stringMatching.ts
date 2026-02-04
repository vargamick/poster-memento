/**
 * String Matching Utilities for QA Validation
 *
 * Provides fuzzy string matching and normalization functions
 * for comparing extracted text with external data sources.
 */

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Create distance matrix
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill in the rest of the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate normalized similarity score (0-1) using Levenshtein distance
 */
export function levenshteinSimilarity(str1: string, str2: string): number {
  if (!str1 && !str2) return 1;
  if (!str1 || !str2) return 0;

  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

/**
 * Calculate Jaro-Winkler similarity (better for names)
 * Returns value between 0 and 1
 */
export function jaroWinklerSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  const len1 = s1.length;
  const len2 = s2.length;

  // Calculate match window
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  if (matchWindow < 0) return 0;

  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  // Calculate Jaro similarity
  const jaro = (
    matches / len1 +
    matches / len2 +
    (matches - transpositions / 2) / matches
  ) / 3;

  // Calculate common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  // Jaro-Winkler adjustment
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Normalize a string for comparison
 * - Lowercase
 * - Remove diacritics
 * - Remove common prefixes (The, A, An)
 * - Remove punctuation
 * - Collapse whitespace
 */
export function normalizeString(str: string): string {
  if (!str) return '';

  return str
    // Lowercase
    .toLowerCase()
    // Remove diacritics (accented characters)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Remove common prefixes
    .replace(/^(the|a|an)\s+/i, '')
    // Remove punctuation except apostrophes in names
    .replace(/[^\w\s']/g, '')
    // Replace apostrophes with empty string for matching
    .replace(/'/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize an artist name for comparison
 * Handles common variations in artist names
 */
export function normalizeArtistName(name: string): string {
  if (!name) return '';

  let normalized = normalizeString(name);

  // Handle "and" vs "&"
  normalized = normalized.replace(/\s+and\s+/g, ' ');
  normalized = normalized.replace(/\s*&\s*/g, ' ');

  // Remove common suffixes
  normalized = normalized.replace(/\s+(band|group|ensemble|orchestra|quartet|trio|duo)$/i, '');

  // Remove featuring/feat/ft
  normalized = normalized.replace(/\s*(featuring|feat\.?|ft\.?)\s+.+$/i, '');

  return normalized.trim();
}

/**
 * Calculate combined similarity score using multiple methods
 * Returns a score between 0 and 1
 */
export function combinedSimilarity(str1: string, str2: string): number {
  const normalized1 = normalizeString(str1);
  const normalized2 = normalizeString(str2);

  // Exact match after normalization
  if (normalized1 === normalized2) return 1;

  // Calculate multiple similarity scores
  const levenshtein = levenshteinSimilarity(normalized1, normalized2);
  const jaroWinkler = jaroWinklerSimilarity(normalized1, normalized2);

  // Check if one contains the other
  const containsBonus = (
    normalized1.includes(normalized2) ||
    normalized2.includes(normalized1)
  ) ? 0.1 : 0;

  // Weighted average (Jaro-Winkler is better for names)
  return Math.min(1, jaroWinkler * 0.6 + levenshtein * 0.4 + containsBonus);
}

/**
 * Calculate artist name similarity with special handling
 */
export function artistSimilarity(name1: string, name2: string): number {
  const normalized1 = normalizeArtistName(name1);
  const normalized2 = normalizeArtistName(name2);

  // Exact match after normalization
  if (normalized1 === normalized2) return 1;

  // Check if one is an acronym of the other
  const acronym1 = normalized1.split(/\s+/).map(w => w[0]).join('');
  const acronym2 = normalized2.split(/\s+/).map(w => w[0]).join('');

  if (acronym1 === normalized2 || acronym2 === normalized1) {
    return 0.9; // High confidence for acronym matches
  }

  return combinedSimilarity(normalized1, normalized2);
}

/**
 * Find best match from a list of candidates
 */
export function findBestMatch(
  target: string,
  candidates: string[],
  similarityFn: (a: string, b: string) => number = combinedSimilarity
): { match: string; score: number; index: number } | null {
  if (!target || !candidates.length) return null;

  let bestMatch = '';
  let bestScore = 0;
  let bestIndex = -1;

  for (let i = 0; i < candidates.length; i++) {
    const score = similarityFn(target, candidates[i]);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidates[i];
      bestIndex = i;
    }
  }

  return bestScore > 0 ? { match: bestMatch, score: bestScore, index: bestIndex } : null;
}

/**
 * Check if two strings are likely the same with a threshold
 */
export function isLikelyMatch(
  str1: string,
  str2: string,
  threshold: number = 0.8,
  similarityFn: (a: string, b: string) => number = combinedSimilarity
): boolean {
  return similarityFn(str1, str2) >= threshold;
}

/**
 * Determine match status based on similarity score
 */
export function getMatchStatus(
  score: number,
  thresholds = { match: 0.9, partial: 0.7 }
): 'match' | 'partial' | 'mismatch' {
  if (score >= thresholds.match) return 'match';
  if (score >= thresholds.partial) return 'partial';
  return 'mismatch';
}

/**
 * Extract potential artist names from text
 * Useful for parsing poster text
 */
export function extractPotentialNames(text: string): string[] {
  if (!text) return [];

  const names: string[] = [];

  // Split by common delimiters
  const parts = text.split(/[,&+•·\n|]/);

  for (const part of parts) {
    const trimmed = part.trim();

    // Skip if too short or too long
    if (trimmed.length < 2 || trimmed.length > 100) continue;

    // Skip if contains too many numbers (probably a date or address)
    if ((trimmed.match(/\d/g) || []).length > 4) continue;

    // Skip common non-name phrases
    const skipPhrases = [
      'tickets', 'admission', 'doors', 'show', 'starts',
      'ages', 'all ages', 'presented by', 'with special guest',
      'featuring', 'live at', 'appearing at'
    ];

    const lowerTrimmed = trimmed.toLowerCase();
    if (skipPhrases.some(phrase => lowerTrimmed.includes(phrase))) continue;

    names.push(trimmed);
  }

  return names;
}
