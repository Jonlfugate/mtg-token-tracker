import type { TokenDefinition, ScryfallCard, ScryfallTokenData } from '../types';
import { getOracleText } from './cardUtils';

const WORD_TO_NUM: Record<string, number> = {
  'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
  'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'that many': -1, 'x': -1,
};

const KEYWORDS = [
  'flying', 'haste', 'trample', 'vigilance', 'lifelink', 'deathtouch',
  'first strike', 'double strike', 'menace', 'reach', 'hexproof',
  'indestructible', 'defender',
];

const CREATE_TOKEN_REGEX = /[Cc]reates?\s+(.+?\btokens?\b)/g;
const CONDITION_REGEX = /[Ii]f\s+(.+?),\s+create\s+(.+?\btokens?\b.*?)\s+instead/g;
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

function parseCondition(conditionText: string): string {
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
  const cleaned = conditionText.trim().replace(/^you\s+/i, '').replace(/\s+/g, ' ');
  if (cleaned.length > 30) return cleaned.slice(0, 27) + '...';
  return cleaned;
}

/** Try to extract a token name hint from a "create...token" snippet */
function extractTokenNameHint(snippet: string): string {
  const lower = snippet.toLowerCase();

  // Predefined token types
  const predefined = [
    'treasure', 'food', 'clue', 'blood', 'map', 'powerstone',
    'junk', 'gold', 'incubator', 'shard', 'rock',
  ];
  for (const name of predefined) {
    if (lower.includes(name)) return name;
  }

  // Try to find creature type name from "P/T <color> <name> creature token" pattern
  const ptNameMatch = snippet.match(/(?:\d+\/\d+|\*\/\*)\s+[\w\s]*?\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:creature|artifact|enchantment)/);
  if (ptNameMatch) return ptNameMatch[1];

  return '';
}

/** Match a name hint from oracle text against Scryfall token data */
function matchTokenData(hint: string, tokenDataList: ScryfallTokenData[]): ScryfallTokenData | null {
  if (!hint || tokenDataList.length === 0) return null;
  const lowerHint = hint.toLowerCase();

  // Exact name match first
  const exact = tokenDataList.find(t => t.name.toLowerCase() === lowerHint);
  if (exact) return exact;

  // Partial match — token name contains hint or hint contains token name
  const partial = tokenDataList.find(t =>
    t.name.toLowerCase().includes(lowerHint) || lowerHint.includes(t.name.toLowerCase())
  );
  if (partial) return partial;

  return null;
}

/** Build a TokenDefinition from Scryfall token data */
function buildTokenDefFromData(data: ScryfallTokenData, count: number, rawText: string): TokenDefinition {
  const types: string[] = [];
  const typeLine = data.type_line.toLowerCase();
  if (typeLine.includes('creature')) types.push('creature');
  if (typeLine.includes('artifact')) types.push('artifact');
  if (typeLine.includes('enchantment')) types.push('enchantment');

  return {
    count,
    power: data.power || '',
    toughness: data.toughness || '',
    colors: data.colors,
    name: data.name,
    types: types.length > 0 ? types : ['creature'],
    keywords: data.keywords.filter(k => KEYWORDS.includes(k.toLowerCase())).map(k => k.toLowerCase()),
    rawText,
  };
}

/** Fallback: regex-parse token from text snippet (when no Scryfall data available) */
function parseTokenSnippetFallback(snippet: string): TokenDefinition | null {
  const lower = snippet.toLowerCase();
  const count = parseCount(lower);

  let power = '';
  let toughness = '';
  const ptMatch = snippet.match(/(\d+|\*)\s*\/\s*(\d+|\*)/);
  if (ptMatch) {
    power = ptMatch[1];
    toughness = ptMatch[2];
  }

  const COLORS = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const colors = COLORS.filter(c => lower.includes(c));

  const types: string[] = [];
  if (lower.includes('creature')) types.push('creature');
  if (lower.includes('artifact')) types.push('artifact');
  if (lower.includes('enchantment')) types.push('enchantment');

  const predefined: Record<string, string[]> = {
    'treasure': ['artifact'], 'food': ['artifact'], 'clue': ['artifact'],
    'blood': ['artifact'], 'map': ['artifact'], 'powerstone': ['artifact'],
    'junk': ['artifact'], 'gold': ['artifact'], 'incubator': ['artifact'],
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

export function detectTokens(card: ScryfallCard, tokenData: ScryfallTokenData[] = []): TokenDefinition[] {
  const oracleText = getOracleText(card);
  const abilities = oracleText.split('\n').filter(line => line.trim().length > 0);
  const tokens: TokenDefinition[] = [];
  const seen = new Set<string>();

  // Detect if this card has a modal "choose one" pattern
  const isModal = /choose\s+one\s*(?:—|:|\.| or\s+both| or\s+more| that\s+hasn)/i.test(oracleText);

  // Process each ability line independently
  // Strip reminder text in parentheses to avoid double-counting keyword mechanics
  for (const rawAbility of abilities) {
    const ability = rawAbility.replace(/\([^)]*\)/g, '').trim();
    if (!ability) continue;
    // Check for "copy of" tokens
    COPY_TOKEN_REGEX.lastIndex = 0;
    let copyMatch;
    while ((copyMatch = COPY_TOKEN_REGEX.exec(ability)) !== null) {
      const copyOf = copyMatch[1].trim().replace(/\b(?:this creature|itself|it)\b/i, card.name);
      // Check if there's a preceding condition
      const textBefore = ability.substring(0, copyMatch.index);
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
        rawText: copyMatch[0].trim(),
        condition,
        isConditional: !!condition,
        isReplacement: !!condition, // "instead" — replaces default token
      };

      const key = `${copyToken.name}-copy`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(copyToken);
      }
    }

    // Check for "If [condition], create [token] instead"
    CONDITION_REGEX.lastIndex = 0;
    let condMatch;
    while ((condMatch = CONDITION_REGEX.exec(ability)) !== null) {
      // Skip "copy of" tokens — handled by COPY_TOKEN_REGEX above
      if (/copy\s+of/i.test(condMatch[2])) continue;

      const condition = parseCondition(condMatch[1]);
      const snippet = condMatch[2];
      const count = parseCount(snippet.toLowerCase());
      const hint = extractTokenNameHint(snippet);
      const matched = matchTokenData(hint, tokenData);

      let parsed: TokenDefinition | null;
      if (matched) {
        parsed = buildTokenDefFromData(matched, count, snippet.trim());
      } else {
        parsed = parseTokenSnippetFallback(snippet);
      }
      if (parsed) {
        parsed.condition = condition;
        parsed.isConditional = true;
        parsed.isReplacement = true; // "instead" — replaces default token
        const key = `${parsed.name}-${parsed.power}/${parsed.toughness}-cond`;
        if (!seen.has(key)) {
          seen.add(key);
          tokens.push(parsed);
        }
      }
    }

    // Check for regular "create...token" on this line
    CREATE_TOKEN_REGEX.lastIndex = 0;
    let match;
    while ((match = CREATE_TOKEN_REGEX.exec(ability)) !== null) {
      // Skip if part of a conditional "instead" clause
      // Look ahead to end of sentence for "instead" (may have keywords between token and instead)
      const matchEnd = match.index + match[0].length;
      const restOfSentence = ability.substring(matchEnd).split(/[.;]/)[0];
      if (/\binstead\b/i.test(restOfSentence)) continue;

      // Skip "copy of" tokens (handled above)
      if (/copy\s+of/i.test(match[1])) continue;

      const snippet = match[1];
      const count = parseCount(snippet.toLowerCase());
      const hint = extractTokenNameHint(snippet);
      const matched = matchTokenData(hint, tokenData);

      let parsed: TokenDefinition | null;
      if (matched) {
        parsed = buildTokenDefFromData(matched, count, snippet.trim());
      } else {
        parsed = parseTokenSnippetFallback(snippet);
      }
      if (parsed) {
        // Check for variable count ("for each", "equal to") — only within same clause
        const sameClause = ability.substring(matchEnd).split(/[.;]/)[0].toLowerCase();
        if (/for each\b/.test(sameClause) || /equal to\b/.test(sameClause)) {
          // Check if count is based on copies of this card ("named [card name]")
          if (new RegExp(`named\\s+${card.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(sameClause)) {
            parsed.countMode = 'self-copies';
            parsed.count = 0; // will be calculated from battlefield state
          } else {
            parsed.count = -1;
          }
        }

        // If the card is modal, mark as conditional
        if (isModal) {
          parsed.isConditional = true;
          parsed.condition = parsed.name;
        }

        const key = `${parsed.name}-${parsed.power}/${parsed.toughness}`;
        if (!seen.has(key)) {
          seen.add(key);
          tokens.push(parsed);
        }
      }
    }
  }

  // Detect keyword mechanics that create tokens (amass, fabricate, incubate)
  // These don't use "create...token" in oracle text — the mechanic is in reminder text
  // Skip if the main regex already found tokens with the same name (reminder text was included)
  const existingNames = new Set(tokens.map(t => t.name.toLowerCase()));
  for (const ability of abilities) {
    // Amass: "amass [Type] N" — creates or grows an Army token
    const amassMatch = ability.match(/\bamass\s+(\w+)\s+(\d+|X)/i);
    if (amassMatch && !existingNames.has(`${amassMatch[1].toLowerCase()} army`)) {
      const subtype = amassMatch[1]; // e.g., "Orcs", "Zombies"
      const count = amassMatch[2].toLowerCase() === 'x' ? -1 : parseInt(amassMatch[2], 10);
      // Try to find the Army token in Scryfall data
      const armyData = tokenData.find(t => t.type_line.toLowerCase().includes('army'));
      const def: TokenDefinition = armyData
        ? { ...buildTokenDefFromData(armyData, count, amassMatch[0]), name: `${subtype} Army` }
        : {
            count,
            power: '0', toughness: '0',
            colors: [], name: `${subtype} Army`,
            types: ['creature'], keywords: [],
            rawText: amassMatch[0],
          };
      const key = `${def.name}-amass`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(def);
      }
    }

    // Fabricate: "fabricate N" — choose N +1/+1 counters or N 1/1 Servo tokens
    const fabricateMatch = ability.match(/\bfabricate\s+(\d+)/i);
    if (fabricateMatch && !existingNames.has('servo')) {
      const count = parseInt(fabricateMatch[1], 10);
      const servoData = tokenData.find(t => t.name.toLowerCase() === 'servo');
      const def: TokenDefinition = servoData
        ? buildTokenDefFromData(servoData, count, fabricateMatch[0])
        : {
            count,
            power: '1', toughness: '1',
            colors: ['colorless'], name: 'Servo',
            types: ['artifact', 'creature'], keywords: [],
            rawText: fabricateMatch[0],
          };
      def.isConditional = true;
      def.condition = 'Servo tokens';
      const key = `${def.name}-fabricate`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(def);
      }
    }

    // Incubate: "incubate N" — creates an Incubator artifact token
    const incubateMatch = ability.match(/\bincubate\s+(\d+|X)/i);
    if (incubateMatch && !existingNames.has('incubator')) {
      const count = incubateMatch[1].toLowerCase() === 'x' ? -1 : 1;
      const incData = tokenData.find(t => t.name.toLowerCase().includes('incubator'));
      const def: TokenDefinition = incData
        ? buildTokenDefFromData(incData, count, incubateMatch[0])
        : {
            count,
            power: '0', toughness: '0',
            colors: ['colorless'], name: 'Incubator',
            types: ['artifact'], keywords: [],
            rawText: incubateMatch[0],
          };
      const key = `${def.name}-incubate`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(def);
      }
    }
  }

  // If we found no tokens from text but have Scryfall token data and the card
  // mentions tokens, try matching directly
  if (tokens.length === 0 && tokenData.length > 0 && /token/i.test(oracleText)) {
    for (const td of tokenData) {
      // Verify this token's name appears somewhere in the oracle text
      const nameHint = td.name.toLowerCase();
      if (oracleText.toLowerCase().includes(nameHint) || oracleText.toLowerCase().includes('token')) {
        const def = buildTokenDefFromData(td, 1, oracleText);
        const key = `${def.name}-${def.power}/${def.toughness}`;
        if (!seen.has(key)) {
          seen.add(key);
          tokens.push(def);
        }
      }
    }
  }

  return tokens;
}
