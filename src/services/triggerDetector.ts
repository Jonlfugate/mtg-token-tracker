import type { ScryfallCard } from '../types';
import { getOracleText, splitAbilities } from './cardUtils';

export type TriggerType = 'upkeep' | 'end-step' | 'tap' | 'landfall' | 'combat' | 'death' | 'cast' | 'activate' | 'etb' | 'other';

interface TriggerPattern {
  regex: RegExp;
  type: TriggerType;
  label: string;
}

// Patterns to detect what trigger an ability line uses.
// Order matters — more specific patterns first.
const TRIGGER_PATTERNS: TriggerPattern[] = [
  { regex: /whenever (?:a |this )?land.*(?:you control )?enters/i, type: 'landfall', label: 'Landfall' },
  { regex: /landfall/i, type: 'landfall', label: 'Landfall' },
  { regex: /at the beginning of (?:each|your) upkeep/i, type: 'upkeep', label: 'Upkeep' },
  { regex: /at the beginning of (?:each|your) end step/i, type: 'end-step', label: 'End Step' },
  { regex: /at the beginning of (?:each|your) first main phase/i, type: 'upkeep', label: 'Main Phase' },
  { regex: /at the beginning of combat/i, type: 'combat', label: 'Combat' },
  { regex: /whenever.*(?:attacks?|enters .* attacking)/i, type: 'combat', label: 'Attack' },
  { regex: /whenever.*deals? combat damage/i, type: 'combat', label: 'Combat Damage' },
  { regex: /when(?:ever)?.*dies/i, type: 'death', label: 'Death' },
  { regex: /whenever.*(?:put into (?:a |your )?graveyard|sacrifice)/i, type: 'other', label: 'Graveyard' },
  { regex: /whenever you cast/i, type: 'cast', label: 'Cast' },
  { regex: /whenever (?:a|another).*(?:enters|enters the battlefield)/i, type: 'other', label: 'Trigger' },
  { regex: /when\b.*enters/i, type: 'etb', label: 'ETB' },
  { regex: /\{T\}/i, type: 'tap', label: 'Tap' },
];

const TOKEN_LINE_RE = /create.*token|populate|fabricate|amass|incubate/i;

export function detectTriggerType(card: ScryfallCard): { type: TriggerType; label: string; alsoEtb?: boolean } | null {
  const abilities = splitAbilities(card);

  // Find ability line indices that create tokens or populate
  // Strip reminder text in parentheses to avoid false matches
  const tokenLineIndices: number[] = [];
  for (let i = 0; i < abilities.length; i++) {
    const stripped = abilities[i].replace(/\([^)]*\)/g, '');
    if (TOKEN_LINE_RE.test(stripped)) {
      tokenLineIndices.push(i);
    }
  }

  // If no lines create tokens, check the whole text as fallback
  if (tokenLineIndices.length === 0) {
    const fullText = getOracleText(card);
    if (/create.*token/i.test(fullText)) {
      return { type: 'activate', label: 'Activate' };
    }
    return null;
  }

  // Check each token-creating line for its trigger.
  // If the line itself has no trigger, check preceding lines for context
  // (handles modal abilities where "Landfall — ... choose one —" is on one line
  // and "• Create a token" is on the next)
  for (const idx of tokenLineIndices) {
    const line = abilities[idx].replace(/\([^)]*\)/g, '');

    // Detect dual triggers like "enters the battlefield or attacks"
    const alsoEtb = /enters.*(?:or|and)\s+attacks/i.test(line) || /attacks.*(?:or|and)\s+enters/i.test(line);

    // First check the token line itself
    for (const pattern of TRIGGER_PATTERNS) {
      if (pattern.regex.test(line)) {
        return { type: pattern.type, label: pattern.label, alsoEtb: alsoEtb || undefined };
      }
    }

    // Check preceding lines for trigger context (modal choices, etc.)
    for (let prev = idx - 1; prev >= 0; prev--) {
      for (const pattern of TRIGGER_PATTERNS) {
        if (pattern.regex.test(abilities[prev])) {
          return { type: pattern.type, label: pattern.label, alsoEtb: alsoEtb || undefined };
        }
      }
      // Stop searching if we hit another complete ability (not a bullet point)
      if (!abilities[prev].trim().startsWith('•') && !abilities[prev + 1]?.trim().startsWith('•')) {
        break;
      }
    }
  }

  // Token-creating lines with no detected trigger — likely ETB or one-shot
  for (const idx of tokenLineIndices) {
    if (/^when\b/i.test(abilities[idx])) {
      return { type: 'etb', label: 'ETB' };
    }
  }

  // Keyword mechanics (fabricate, incubate) are ETB by definition on creatures
  for (const idx of tokenLineIndices) {
    if (/\b(?:fabricate|incubate)\b/i.test(abilities[idx])) {
      return { type: 'etb', label: 'ETB' };
    }
  }

  // Fallback: check if it's an activated ability (has a colon cost pattern)
  for (const idx of tokenLineIndices) {
    if (/\{.*\}.*:/i.test(abilities[idx]) || /\btap\b/i.test(abilities[idx])) {
      return { type: 'activate', label: 'Activate' };
    }
  }

  return null;
}
