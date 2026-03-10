import type { ScryfallCard } from '../types';

export type TriggerType = 'upkeep' | 'tap' | 'landfall' | 'combat' | 'death' | 'cast' | 'activate' | 'etb';

interface TriggerPattern {
  regex: RegExp;
  type: TriggerType;
  label: string;
}

const TRIGGER_PATTERNS: TriggerPattern[] = [
  // ETB — check early since many cards mention "enters the battlefield tapped" alongside tap abilities
  { regex: /when.*enters the battlefield.*create.*token/is, type: 'etb', label: 'ETB' },
  { regex: /when.*enters.*create.*token/is, type: 'etb', label: 'ETB' },
  // Tap abilities
  { regex: /\{T\}.*create.*token/is, type: 'tap', label: 'Tap' },
  { regex: /\btap\b.*create.*token/i, type: 'tap', label: 'Tap' },
  // Recurring triggers
  { regex: /at the beginning of (?:each|your) upkeep/i, type: 'upkeep', label: 'Upkeep' },
  { regex: /at the beginning of (?:each|your) end step/i, type: 'upkeep', label: 'End Step' },
  { regex: /whenever a land enters/i, type: 'landfall', label: 'Landfall' },
  { regex: /landfall/i, type: 'landfall', label: 'Landfall' },
  { regex: /whenever.*attacks/i, type: 'combat', label: 'Attack' },
  { regex: /whenever.*deals combat damage/i, type: 'combat', label: 'Combat Damage' },
  { regex: /whenever.*dies/i, type: 'death', label: 'Death' },
  { regex: /whenever you cast/i, type: 'cast', label: 'Cast' },
  // Generic ETB fallback
  { regex: /when.*enters the battlefield/i, type: 'etb', label: 'ETB' },
  { regex: /when.*enters/i, type: 'etb', label: 'ETB' },
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
