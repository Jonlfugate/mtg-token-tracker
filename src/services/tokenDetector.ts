import type { TokenDefinition, ScryfallCard } from '../types';

const WORD_TO_NUM: Record<string, number> = {
  'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
  'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'that many': -1, 'x': -1,
};

const COLORS = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
const KEYWORDS = [
  'flying', 'haste', 'trample', 'vigilance', 'lifelink', 'deathtouch',
  'first strike', 'double strike', 'menace', 'reach', 'hexproof',
  'indestructible', 'defender',
];

const CREATE_TOKEN_REGEX = /[Cc]reates?\s+(.+?\btokens?\b)/g;

// Detect "If [condition], create [token] instead" patterns
const CONDITION_REGEX = /[Ii]f\s+(.+?),\s+create\s+(.+?\btokens?\b)\s+instead/g;

// Detect "create a token that's a copy of" patterns
const COPY_TOKEN_REGEX = /create\s+a\s+token\s+that'?s\s+a\s+copy\s+of\s+(.+?)(?:\s+instead)?[.,]/gi;

function parseCount(text: string): number {
  const lower = text.toLowerCase().trim();
  for (const [word, num] of Object.entries(WORD_TO_NUM)) {
    if (lower.startsWith(word)) return num;
  }
  const digitMatch = lower.match(/^(\d+)/);
  if (digitMatch) return parseInt(digitMatch[1], 10);
  return 1;
}

function parseTokenSnippet(snippet: string): TokenDefinition | null {
  const lower = snippet.toLowerCase();

  const count = parseCount(lower);

  let power = '';
  let toughness = '';
  const ptMatch = snippet.match(/(\d+|\*)\s*\/\s*(\d+|\*)/);
  if (ptMatch) {
    power = ptMatch[1];
    toughness = ptMatch[2];
  }

  const colors = COLORS.filter(c => lower.includes(c));

  const types: string[] = [];
  if (lower.includes('creature')) types.push('creature');
  if (lower.includes('artifact')) types.push('artifact');
  if (lower.includes('enchantment')) types.push('enchantment');

  const predefined: Record<string, string[]> = {
    'treasure': ['artifact'],
    'food': ['artifact'],
    'clue': ['artifact'],
    'blood': ['artifact'],
    'map': ['artifact'],
    'powerstone': ['artifact'],
    'junk': ['artifact'],
    'gold': ['artifact'],
    'incubator': ['artifact'],
  };

  let name = '';
  const skipWords = new Set([
    ...COLORS, ...KEYWORDS, 'creature', 'artifact', 'enchantment', 'token', 'tokens',
    'with', 'and', 'that', 'named', 'has', 'have', 'the', 'a', 'an', 'of',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'tapped', 'attacking',
  ]);

  for (const [tokenName, tokenTypes] of Object.entries(predefined)) {
    if (lower.includes(tokenName)) {
      name = tokenName.charAt(0).toUpperCase() + tokenName.slice(1);
      if (types.length === 0) types.push(...tokenTypes);
      break;
    }
  }

  if (!name) {
    const nameMatch = snippet.match(/(\d+\/\d+|\*\/\*)\s+([\w\s]+?)\s+(creature|artifact|enchantment)/i);
    if (nameMatch) {
      const nameParts = nameMatch[2].trim().split(/\s+/).filter(w => !skipWords.has(w.toLowerCase()));
      name = nameParts.join(' ');
    }
  }

  if (!name) {
    const words = snippet.split(/\s+/);
    const tokenIdx = words.findIndex(w => w.toLowerCase().startsWith('token'));
    if (tokenIdx > 0) {
      for (let i = tokenIdx - 1; i >= 0; i--) {
        const w = words[i].replace(/[^a-zA-Z]/g, '');
        if (w && !skipWords.has(w.toLowerCase()) && /^[A-Z]/.test(w)) {
          name = w;
          break;
        }
      }
    }
  }

  const foundKeywords = KEYWORDS.filter(k => lower.includes(k));

  if (!name && types.length === 0) return null;

  return {
    count,
    power,
    toughness,
    colors,
    name: name || 'Token',
    types: types.length > 0 ? types : ['creature'],
    keywords: foundKeywords,
    rawText: snippet.trim(),
  };
}

function parseCondition(conditionText: string): string {
  // Simplify condition text for display
  const lower = conditionText.toLowerCase().trim();
  if (lower.includes('six or more lands')) return '6+ lands';
  if (lower.includes('seven or more lands')) return '7+ lands';
  if (lower.includes('five or more lands')) return '5+ lands';
  if (lower.includes('ten or more')) return '10+ creatures';
  if (lower.includes("city's blessing")) return "City's blessing";
  if (lower.includes('gained life')) return 'Gained life';
  if (lower.includes('dealt damage')) return 'Dealt damage';
  if (lower.includes('cast a spell')) return 'Cast a spell';
  if (lower.includes('attacked')) return 'Attacked';
  // Generic: clean up and truncate
  const cleaned = conditionText.trim().replace(/^you\s+/i, '').replace(/\s+/g, ' ');
  if (cleaned.length > 30) return cleaned.slice(0, 27) + '...';
  return cleaned;
}

function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces) {
    return card.card_faces.map(f => f.oracle_text || '').join('\n');
  }
  return '';
}

export function detectTokens(card: ScryfallCard): TokenDefinition[] {
  const oracleText = getOracleText(card);
  const tokens: TokenDefinition[] = [];
  const seen = new Set<string>();

  // First, detect conditional "instead" tokens
  const conditionalTokenNames = new Set<string>();
  let condMatch;

  // Check for "copy of this creature/itself" conditional patterns
  COPY_TOKEN_REGEX.lastIndex = 0;
  while ((condMatch = COPY_TOKEN_REGEX.exec(oracleText)) !== null) {
    const copyOf = condMatch[1].trim().replace(/this creature|itself/i, card.name);
    // Find the condition that precedes this
    const textBefore = oracleText.substring(0, condMatch.index);
    const ifMatch = textBefore.match(/[Ii]f\s+(.+?),\s*$/);
    const condition = ifMatch ? parseCondition(ifMatch[1]) : undefined;

    const copyToken: TokenDefinition = {
      count: 1,
      power: '',
      toughness: '',
      colors: [],
      name: `Copy of ${copyOf}`,
      types: ['creature'],
      keywords: [],
      rawText: condMatch[0].trim(),
      condition,
      isConditional: true,
    };

    const key = `${copyToken.name}-copy`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(copyToken);
      conditionalTokenNames.add(key);
    }
  }

  // Check for "If [condition], create [token] instead" (non-copy)
  CONDITION_REGEX.lastIndex = 0;
  while ((condMatch = CONDITION_REGEX.exec(oracleText)) !== null) {
    const condition = parseCondition(condMatch[1]);
    const snippet = condMatch[2];
    const parsed = parseTokenSnippet(snippet);
    if (parsed) {
      parsed.condition = condition;
      parsed.isConditional = true;
      const key = `${parsed.name}-${parsed.power}/${parsed.toughness}-cond`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(parsed);
        conditionalTokenNames.add(key);
      }
    }
  }

  // Detect if this card has a modal "choose one" / "choose one —" pattern
  // where token creation is one of the choices (e.g., Felidar Retreat)
  const isModal = /choose\s+one\s*(?:—|:|\.|or\s+both)/i.test(oracleText);

  // Now detect regular (non-conditional) tokens
  let match;
  CREATE_TOKEN_REGEX.lastIndex = 0;
  while ((match = CREATE_TOKEN_REGEX.exec(oracleText)) !== null) {
    // Skip if this match is part of a conditional "instead" clause
    const matchEnd = match.index + match[0].length;
    const textAfter = oracleText.substring(matchEnd, matchEnd + 20);
    if (textAfter.trim().startsWith('instead')) continue;

    // Skip "copy of" tokens (handled above)
    if (/copy\s+of/i.test(match[1])) continue;

    const snippet = match[1];
    const parsed = parseTokenSnippet(snippet);
    if (parsed) {
      // Check if count is variable ("for each", "equal to", "that many")
      const fullMatchEnd = match.index + match[0].length;
      const textAfterToken = oracleText.substring(fullMatchEnd, fullMatchEnd + 50).toLowerCase();
      if (/for each\b/.test(textAfterToken) || /equal to\b/.test(textAfterToken)) {
        parsed.count = -1; // variable
      }

      // If the card is modal, mark token creation as conditional
      // so the player can opt-in via checkbox for bulk triggers
      if (isModal) {
        parsed.isConditional = true;
        parsed.condition = 'Choose tokens';
      }
      const key = `${parsed.name}-${parsed.power}/${parsed.toughness}`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(parsed);
      }
    }
  }

  return tokens;
}
