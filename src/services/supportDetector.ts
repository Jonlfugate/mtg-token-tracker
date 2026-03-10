import type { SupportEffect, ScryfallCard } from '../types';

interface SupportPattern {
  regex: RegExp;
  type: 'multiplier' | 'additional';
  factor: number;
  condition?: string;
}

const SUPPORT_PATTERNS: SupportPattern[] = [
  // "creates twice that many of those tokens instead"
  { regex: /twice\s+that\s+many/i, type: 'multiplier', factor: 2 },
  // "double the number of those tokens"
  { regex: /double\s+the\s+number/i, type: 'multiplier', factor: 2 },
  // "three times that many"
  { regex: /three\s+times\s+that\s+many/i, type: 'multiplier', factor: 3 },
  // "that many plus one" (Mondrak-style)
  { regex: /that\s+many\s+plus\s+one/i, type: 'additional', factor: 1 },
  // "plus one additional"
  { regex: /plus\s+one\s+additional/i, type: 'additional', factor: 1 },
  // "create one additional copy" / "an additional token"
  { regex: /an?\s+additional\s+(?:copy|token)/i, type: 'additional', factor: 1 },
  // "plus that many" (e.g. creates double)
  { regex: /creates?\s+(?:that\s+many\s+tokens?\s+)?plus\s+that\s+many/i, type: 'multiplier', factor: 2 },
];

function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces) {
    return card.card_faces.map(f => f.oracle_text || '').join('\n');
  }
  return '';
}

export function detectSupport(card: ScryfallCard): SupportEffect | undefined {
  const oracleText = getOracleText(card);

  // Must reference tokens in the text to be a token support card
  if (!/token/i.test(oracleText)) return undefined;

  for (const pattern of SUPPORT_PATTERNS) {
    const match = oracleText.match(pattern.regex);
    if (match) {
      // Try to detect condition (creature tokens only, etc.)
      let condition: string | undefined;
      if (/creature\s+token/i.test(oracleText) && !/token/i.test(oracleText.replace(/creature\s+token/gi, ''))) {
        condition = 'creature tokens';
      }

      return {
        type: pattern.type,
        factor: pattern.factor,
        condition,
        rawText: match[0],
      };
    }
  }

  return undefined;
}
