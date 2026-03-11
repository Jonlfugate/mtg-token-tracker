import type { SupportEffect, ScryfallCard } from '../types';
import { getOracleText } from './cardUtils';

interface SupportPattern {
  regex: RegExp;
  type: 'multiplier' | 'additional' | 'companion';
  factor: number;
  condition?: string;
}

const SUPPORT_PATTERNS: SupportPattern[] = [
  // "creates twice that many of those tokens instead"
  { regex: /twice\s+that\s+many.*token/i, type: 'multiplier', factor: 2 },
  // "double the number of those tokens"
  { regex: /double\s+the\s+number.*token/i, type: 'multiplier', factor: 2 },
  // "three times that many" (tokens)
  { regex: /three\s+times\s+that\s+many.*token/i, type: 'multiplier', factor: 3 },
  // "that many plus one" (Mondrak-style — near tokens)
  { regex: /token.*that\s+many\s+plus\s+one/i, type: 'additional', factor: 1 },
  // "plus one additional"
  { regex: /plus\s+one\s+additional/i, type: 'additional', factor: 1 },
  // "create one additional copy" / "an additional token" / "an additional Treasure token"
  { regex: /an?\s+additional\s+\w*\s*(?:copy|token)/i, type: 'additional', factor: 1 },
  // Chatterfang-style: "those tokens plus that many [P/T] [type] creature tokens are created instead"
  // Must be checked BEFORE the generic "plus that many" additional pattern below
  { regex: /those\s+tokens?\s+plus\s+that\s+many\b/i, type: 'companion', factor: 1 },
  // "also create that many" (alternative Chatterfang wording)
  { regex: /also\s+create\s+that\s+many/i, type: 'companion', factor: 1 },
  // "plus that many" (generic additional — only when not a companion pattern above)
  { regex: /plus\s+that\s+many/i, type: 'additional', factor: 1 },
  // "creates double"
  { regex: /creates?\s+(?:that\s+many\s+tokens?\s+)?plus\s+that\s+many/i, type: 'multiplier', factor: 2 },
  // "instead create one of each" (Academy Manufactor — Clue/Food/Treasure replacement)
  { regex: /instead\s+create\s+one\s+of\s+each/i, type: 'companion', factor: 1 },
];

export function detectSupport(card: ScryfallCard): SupportEffect | undefined {
  const oracleText = getOracleText(card);
  const abilities = oracleText.split('\n').filter(line => line.trim().length > 0);

  // Check each ability line independently
  for (const ability of abilities) {
    for (const pattern of SUPPORT_PATTERNS) {
      const match = ability.match(pattern.regex);
      if (match) {
        // Try to detect condition (creature tokens only, etc.)
        let condition: string | undefined;
        if (/creature\s+token/i.test(ability) && !/token/i.test(ability.replace(/creature\s+token/gi, ''))) {
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
  }

  return undefined;
}
