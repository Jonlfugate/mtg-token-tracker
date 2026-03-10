import type { ScryfallCard } from '../types';

export type TriggerType = 'upkeep' | 'tap' | 'landfall' | 'combat' | 'death' | 'cast' | 'activate' | 'etb';

interface TriggerPattern {
  regex: RegExp;
  type: TriggerType;
  label: string;
}

const TRIGGER_PATTERNS: TriggerPattern[] = [
  // Recurring triggers — check before ETB since "whenever a land enters the battlefield"
  // contains "enters the battlefield" but is landfall, not ETB
  { regex: /whenever a land enters/i, type: 'landfall', label: 'Landfall' },
  { regex: /landfall/i, type: 'landfall', label: 'Landfall' },
  { regex: /at the beginning of (?:each|your) upkeep/i, type: 'upkeep', label: 'Upkeep' },
  { regex: /at the beginning of (?:each|your) end step/i, type: 'upkeep', label: 'End Step' },
  { regex: /whenever.*attacks/i, type: 'combat', label: 'Attack' },
  { regex: /whenever.*deals combat damage/i, type: 'combat', label: 'Combat Damage' },
  { regex: /whenever.*dies/i, type: 'death', label: 'Death' },
  { regex: /whenever you cast/i, type: 'cast', label: 'Cast' },
  // ETB — "When [something] enters" (not "Whenever a land enters")
  { regex: /when\b.*enters the battlefield.*create.*token/is, type: 'etb', label: 'ETB' },
  { regex: /when\b.*enters.*create.*token/is, type: 'etb', label: 'ETB' },
  // Tap abilities
  { regex: /\{T\}.*create.*token/is, type: 'tap', label: 'Tap' },
  { regex: /\btap\b.*create.*token/i, type: 'tap', label: 'Tap' },
  // Generic ETB fallback
  { regex: /when\b.*enters the battlefield/i, type: 'etb', label: 'ETB' },
  { regex: /when\b.*enters/i, type: 'etb', label: 'ETB' },
];

function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces) {
    return card.card_faces.map(f => f.oracle_text || '').join('\n');
  }
  return '';
}

export function detectTriggerType(card: ScryfallCard): { type: TriggerType; label: string } | null {
  const text = getOracleText(card);

  for (const pattern of TRIGGER_PATTERNS) {
    if (pattern.regex.test(text)) {
      return { type: pattern.type, label: pattern.label };
    }
  }

  // If the card creates tokens but we couldn't detect a specific trigger,
  // it's likely an activated ability
  if (/create.*token/i.test(text)) {
    return { type: 'activate', label: 'Activate' };
  }

  return null;
}
