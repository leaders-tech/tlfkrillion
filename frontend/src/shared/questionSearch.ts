/*
Search question-bank text with typo tolerance. Edit this file to adjust how query words match.
*/

export function searchWords(text: string): string[] {
  return text.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function matchesWord(query: string, word: string): boolean {
  if (word.startsWith(query)) return true;
  if (query.length < 4) return false;

  // Compare complete words and prefixes that are one character shorter or longer.
  for (const length of [query.length - 1, query.length, query.length + 1]) {
    if (length > word.length) continue;
    const candidate = word.slice(0, length);
    let i = 0;
    while (i < length && i < query.length && query[i] === candidate[i]) i += 1;
    if (length < query.length && query.slice(i + 1) === candidate.slice(i)) return true;
    if (length > query.length && query.slice(i) === candidate.slice(i + 1)) return true;
    if (length === query.length && (
      query.slice(i + 1) === candidate.slice(i + 1) ||
      (query[i] === candidate[i + 1] && query[i + 1] === candidate[i] && query.slice(i + 2) === candidate.slice(i + 2))
    )) return true;
  }
  return false;
}

export function matchesQuestionSearch(query: string[], words: string[]): boolean {
  return query.every((term) => words.some((word) => matchesWord(term, word)));
}
