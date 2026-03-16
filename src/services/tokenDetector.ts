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
  'indestructible', 'defender', 'decayed',
];

const CREATE_TOKEN_REGEX = /[Cc]reates?\s+(.+?\btokens?\b)/g;
const CONDITION_REGEX = /[Ii]f\s+(.+?),\s+create\s+(.+?\btokens?\b.*?)\s+instead/g;
const COPY_TOKEN_REGEX = /create\s+a\s+token\s+that(?:'s|\s+is)\s+a\s+copy\s+of\s+(.+?)(?:\s+instead)?(?:[.,]|$)/gi;
// Replacement effects that create an *additional* persistent token:
// "those tokens plus (an additional|a) [snippet] are created instead"
// "instead create those tokens plus (an additional|a) [snippet]"
const REPLACEMENT_ADDITIONAL_RE = /\bplus\s+(?:an?\s+(?:additional\s+)?)(.+?\btoken\b)/gi;

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

  // Numeric threshold patterns: "N or more [things]"
  const thresholdMatch = lower.match(/(\w+)\s+or\s+more\s+(\w+)/);
  if (thresholdMatch) {
    const numWord = thresholdMatch[1];
    const thing = thresholdMatch[2];
    const num = WORD_TO_NUM[numWord] ?? parseInt(numWord, 10);
    if (!isNaN(num) && num > 0) return `${num}+ ${thing}`;
  }

  if (lower.includes("city's blessing")) return "City's blessing";
  if (lower.includes('gained life') || lower.includes("you've gained")) return 'Gained life';
  if (lower.includes('dealt damage')) return 'Dealt damage';
  if (lower.includes('cast a spell') || lower.includes("you've cast")) return 'Cast a spell';
  if (lower.includes('attacked')) return 'Attacked';
  if (lower.includes('no snakes')) return 'No Snakes';
  if (/control no (\w+)/i.test(lower)) {
    const m = lower.match(/control no (\w+)/i);
    if (m) return `No ${m[1].charAt(0).toUpperCase() + m[1].slice(1)}`;
  }

  const cleaned = conditionText.trim().replace(/^you\s+/i, '').replace(/\s+/g, ' ');
  if (cleaned.length > 40) return cleaned.slice(0, 37) + '...';
  return cleaned;
}

/** Try to extract a token name hint from a "create...token" snippet */
function extractTokenNameHint(snippet: string): string {
  const lower = snippet.toLowerCase();

  // Predefined artifact token types
  const predefined = [
    'treasure', 'food', 'clue', 'blood', 'map', 'powerstone',
    'junk', 'gold', 'incubator', 'shard', 'rock',
  ];
  for (const name of predefined) {
    if (lower.includes(name)) return name;
  }

  // "P/T <color(s)> <Name> [land] creature/artifact token"
  const ptNameMatch = snippet.match(/(?:\d+\/\d+|\*\/\*)\s+[\w\s]*?\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:land\s+)?(?:creature|artifact|enchantment)/);
  if (ptNameMatch) return ptNameMatch[1];

  // "<Name> creature/artifact token" without explicit P/T (e.g. "a Zombie token", "a Soldier creature token")
  const typeNameMatch = snippet.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:creature\s+)?(?:artifact\s+)?tokens?\b/);
  if (typeNameMatch) {
    const candidate = typeNameMatch[1];
    const skipWords = new Set(['white', 'blue', 'black', 'red', 'green', 'colorless', 'creature', 'artifact', 'enchantment', 'a', 'an', 'the', 'tapped', 'attacking', 'with']);
    const lastWord = candidate.split(' ').pop()!.toLowerCase();
    if (!skipWords.has(lastWord)) return candidate;
  }

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

/**
 * Supplement a parsed TokenDefinition with P/T and colors from Scryfall token data
 * when the fallback parser couldn't extract them from the oracle text.
 * Only fills in missing values — never overrides explicit ones.
 */
function supplementFromTokenData(def: TokenDefinition, tokenData: ScryfallTokenData[]): void {
  if (tokenData.length === 0) return;
  if (def.power && def.toughness && def.colors.length > 0) return; // already complete

  const match = tokenData.find(t => t.name.toLowerCase() === def.name.toLowerCase());
  if (!match) return;

  if (!def.power && match.power) def.power = match.power;
  if (!def.toughness && match.toughness) def.toughness = match.toughness;
  if (def.colors.length === 0 && match.colors.length > 0) def.colors = [...match.colors];
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
    ...COLORS, ...KEYWORDS, 'creature', 'artifact', 'enchantment', 'land', 'token', 'tokens',
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
    const nameMatch = snippet.match(/(\d+\/\d+|\*\/\*)\s+([\w\s]+?)\s+(?:land\s+)?(?:creature|artifact|enchantment)/i);
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
  let conditionCounter = 0;

  // Detect if this card has a modal "choose one" pattern
  // Require the "—" delimiter to avoid false positives like "choose one at random"
  const isModal = /choose\s+one\s*(?:—|:)\s/i.test(oracleText)
    || /choose\s+one\s+or\s+(?:both|more)\s*(?:—|:)/i.test(oracleText);

  // Detect if this card has multiple activated abilities that create tokens
  // (e.g., Rhys the Redeemed: two different {T} abilities)
  const ACTIVATED_TOKEN_RE = /\{.*\}.*:.*create.*token/i;
  const activatedTokenLines = abilities.filter(a => ACTIVATED_TOKEN_RE.test(a.replace(/\([^)]*\)/g, '')));
  const hasMultipleActivated = activatedTokenLines.length > 1;

  // Detect if this card is purely a replacement effect (modifies other token creation)
  const isReplacementEffect = /\bif\b.*\bwould\b.*\btokens?\b.*\binstead\b/i.test(oracleText)
    || /\btokens?\b.*\bwould be created\b.*\binstead\b/i.test(oracleText);

  // Process each ability line independently
  // Strip reminder text in parentheses to avoid double-counting keyword mechanics
  for (const rawAbility of abilities) {
    const ability = rawAbility.replace(/\([^)]*\)/g, '').trim();
    if (!ability) continue;
    // Check for "copy of" tokens
    COPY_TOKEN_REGEX.lastIndex = 0;
    let copyMatch;
    while ((copyMatch = COPY_TOKEN_REGEX.exec(ability)) !== null) {
      const rawCopyOf = copyMatch[1].trim();
      // "For each creature token...copy of that creature" — doubles all creature tokens
      // (e.g., Rhys the Redeemed's second ability)
      if (/\b(?:for each|each)\b.*\bcreature token\b/i.test(ability) && /\b(?:that creature)\b/i.test(rawCopyOf)) {
        if (!seen.has('_double_tokens')) {
          seen.add('_double_tokens');
          tokens.push({
            count: 0,
            power: '', toughness: '', colors: [],
            name: 'Double all creature tokens',
            types: ['creature'],
            keywords: [],
            rawText: ability.trim(),
            conditionKey: `${card.name}-double-tokens`,
            condition: 'Double all creature tokens',
            conditionType: 'activated-choice',
            isConditional: true,
            countMode: 'double-tokens',
          });
        }
        continue;
      }
      // Skip generic copy effects ("copy of that creature/token") — these copy variable targets
      if (/\b(?:that creature|that token|each creature|each token|target creature|target)\b/i.test(rawCopyOf)) continue;
      const copyOf = rawCopyOf.replace(/\b(?:this creature|itself|it)\b/i, card.name);
      // Check if there's a preceding condition
      const textBefore = ability.substring(0, copyMatch.index);
      const ifMatch = textBefore.match(/[Ii]f\s+(.+?),\s*$/);
      const condition = ifMatch ? parseCondition(ifMatch[1]) : undefined;
      // "instead" must be literally present to be a replacement; "Then if" additive copies are not replacements
      const isInstead = /\binstead\b/i.test(copyMatch[0]);
      // "for each token" pattern means this copies all current-turn tokens, not just the card itself
      const isForEachToken = /for\s+each\s+token/i.test(textBefore);
      const copyName = isForEachToken ? `Copy of each token (${condition ?? 'conditional'})` : `Copy of ${copyOf}`;

      const copyToken: TokenDefinition = {
        count: 1,
        power: '',
        toughness: '',
        colors: [],
        name: copyName,
        types: ['creature'],
        keywords: [],
        rawText: copyMatch[0].trim(),
        conditionKey: condition ? `${card.name}-copy-${conditionCounter++}` : undefined,
        condition,
        conditionType: condition ? (isInstead ? 'replacement' : 'board-state') : undefined,
        isConditional: !!condition,
        isReplacement: isInstead, // only true when "instead" is literally present
        countMode: isForEachToken ? 'copy-turn-tokens' : undefined,
      };

      const key = `${copyToken.name}-copy`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(copyToken);
      }
    }

    // Check for replacement effects that add an extra persistent token:
    // "those tokens plus (an additional|a) [snippet] are created instead"
    // "instead create those tokens plus (an additional|a) [snippet]"
    if (/\binstead\b/i.test(ability) && /\bwould\b/i.test(ability)) {
      REPLACEMENT_ADDITIONAL_RE.lastIndex = 0;
      let addMatch;
      while ((addMatch = REPLACEMENT_ADDITIONAL_RE.exec(ability)) !== null) {
        const snippet = addMatch[1].trim();
        const hint = extractTokenNameHint(snippet);
        const matched = matchTokenData(hint, tokenData);
        let parsed: TokenDefinition | null;
        if (matched) {
          parsed = buildTokenDefFromData(matched, 1, snippet);
        } else {
          parsed = parseTokenSnippetFallback(snippet);
          if (parsed) supplementFromTokenData(parsed, tokenData);
        }
        if (parsed) {
          parsed.count = 1;
          const key = `${parsed.name}-${parsed.power}/${parsed.toughness}-addl`;
          if (!seen.has(key)) {
            seen.add(key);
            tokens.push(parsed);
          }
        }
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
        if (parsed) supplementFromTokenData(parsed, tokenData);
      }
      if (parsed) {
        parsed.conditionKey = `${card.name}-cond-${conditionCounter++}`;
        parsed.condition = condition;
        parsed.conditionType = 'replacement';
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

      // Skip "create X of those tokens" — a back-reference to an already-detected token, not a new type
      if (/\bof\s+those\s+tokens?\b/i.test(match[1])) continue;

      // Skip "copy of" tokens (handled above)
      if (/copy\s+of/i.test(match[1])) continue;

      // Skip tokens created by an opponent ("target opponent creates")
      const textBeforeCreate = ability.substring(0, match.index);
      if (/\bopponent\s+creates?$|\bopponent\b/i.test(textBeforeCreate.trimEnd())) continue;

      const snippet = match[1];
      const count = parseCount(snippet.toLowerCase());
      const hint = extractTokenNameHint(snippet);
      const matched = matchTokenData(hint, tokenData);

      let parsed: TokenDefinition | null;
      if (matched) {
        parsed = buildTokenDefFromData(matched, count, snippet.trim());
      } else {
        parsed = parseTokenSnippetFallback(snippet);
        if (parsed) supplementFromTokenData(parsed, tokenData);
      }
      if (parsed) {
        // Pick up keywords from "with X" clause after "token" (not captured by regex)
        const afterToken = ability.substring(matchEnd).toLowerCase();
        const withMatch = afterToken.match(/\bwith\s+(.+?)(?:[.,;]|$)/);
        if (withMatch) {
          const extraKeywords = KEYWORDS.filter(k => withMatch[1].includes(k));
          for (const kw of extraKeywords) {
            if (!parsed.keywords.includes(kw)) parsed.keywords.push(kw);
          }
        }

        // Check for variable count ("for each", "equal to") — look at full ability clause
        const afterMatch = ability.substring(matchEnd).split(/[.;]/)[0].toLowerCase();
        const fullClause = ability.toLowerCase();
        if (/for each\b/.test(afterMatch) || /equal to\b/.test(afterMatch) || /a number of\b/.test(fullClause)) {
          // Check if count is based on copies of this card ("named [card name]")
          if (new RegExp(`named\\s+${card.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(fullClause)) {
            parsed.countMode = 'self-copies';
            parsed.count = 0; // will be calculated from battlefield state
          } else if (/\+1\/\+1 counter|counter on/i.test(fullClause)) {
            parsed.countMode = 'counters';
            parsed.count = -1; // will be resolved from stored counters
          } else {
            parsed.count = -1;
          }
        }

        // If the card is modal, mark as conditional
        if (isModal) {
          parsed.isConditional = true;
          parsed.conditionKey = `${card.name}-modal-${conditionCounter++}`;
          parsed.condition = parsed.name;
          parsed.conditionType = 'modal';
        }

        // Multiple activated abilities on one card: mark as conditional so user can choose
        if (hasMultipleActivated && ACTIVATED_TOKEN_RE.test(ability)) {
          parsed.isConditional = true;
          parsed.conditionKey = parsed.conditionKey || `${card.name}-act-${conditionCounter++}`;
          parsed.condition = parsed.condition || parsed.name;
          parsed.conditionType = parsed.conditionType || 'activated-choice';
        }

        // Detect "if you control no [type]" conditions (e.g., Ophiomancer)
        const noControlMatch = ability.match(/if you control no (\w+)/i);
        if (noControlMatch) {
          parsed.isConditional = true;
          parsed.conditionKey = `${card.name}-board-${conditionCounter++}`;
          parsed.condition = `No ${noControlMatch[1]}`;
          parsed.conditionType = 'board-state';
        }

        // Detect general "if [board-state condition]" preceding the create clause
        // (e.g., "if you control seven or more lands with different names, create...")
        if (!parsed.isConditional) {
          const textBefore = ability.substring(0, match.index);
          const boardStateMatch = textBefore.match(/,\s*if\s+(.+?),?\s*$/i);
          if (boardStateMatch) {
            const condition = parseCondition(boardStateMatch[1].trim());
            parsed.isConditional = true;
            parsed.conditionKey = `${card.name}-board-${conditionCounter++}`;
            parsed.condition = condition;
            parsed.conditionType = 'board-state';
          }
        }

        // Channel abilities are activated from hand (discard cost) — mark as conditional
        // so the user can choose whether to use the Channel or play it as a land
        if (!parsed.isConditional && /^channel\s*[—-]/i.test(ability.trim())) {
          parsed.isConditional = true;
          parsed.conditionKey = `${card.name}-channel-${conditionCounter++}`;
          parsed.condition = 'Channel';
          parsed.conditionType = 'activated-choice';
        }

        // Detect "create [A] or [B]" player-choice patterns (e.g., Tireless Provisioner).
        // The regex only captures up to the first "token", so "or [B]" is missed entirely.
        // If the text immediately after the match is "or [snippet] token(s)", parse the
        // alternative and mark BOTH tokens as mutually exclusive conditional choices.
        const orMatch = restOfSentence.match(/^\s+or\s+(.+?\btokens?\b)/i);
        if (orMatch) {
          // Mark the current token as a player choice
          if (!parsed.isConditional) {
            parsed.isConditional = true;
            parsed.conditionKey = `${card.name}-or-${conditionCounter++}`;
            parsed.condition = parsed.name;
            parsed.conditionType = 'activated-choice';
          }
          // Parse the alternative token
          const altSnippet = orMatch[1].trim();
          const altHint = extractTokenNameHint(altSnippet);
          const altMatched = matchTokenData(altHint, tokenData);
          let altParsed: TokenDefinition | null;
          if (altMatched) {
            altParsed = buildTokenDefFromData(altMatched, parseCount(altSnippet.toLowerCase()), altSnippet);
          } else {
            altParsed = parseTokenSnippetFallback(altSnippet);
            if (altParsed) supplementFromTokenData(altParsed, tokenData);
          }
          if (altParsed) {
            altParsed.isConditional = true;
            altParsed.conditionKey = `${card.name}-or-${conditionCounter++}`;
            altParsed.condition = altParsed.name;
            altParsed.conditionType = 'activated-choice';
            const altKey = `${altParsed.name}-${altParsed.power}/${altParsed.toughness}`;
            if (!seen.has(altKey)) {
              seen.add(altKey);
              tokens.push(altParsed);
            }
          }
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
    if (amassMatch) {
      // Normalize plural subtype to singular: "Zombies" → "Zombie", "Orcs" → "Orc"
      const subtype = amassMatch[1].replace(/s$/i, '');
      const armyName = `${subtype} Army`;
      if (!existingNames.has(armyName.toLowerCase())) {
        const count = amassMatch[2].toLowerCase() === 'x' ? -1 : parseInt(amassMatch[2], 10);
        const armyData = tokenData.find(t => t.type_line.toLowerCase().includes('army'));
        const def: TokenDefinition = armyData
          ? { ...buildTokenDefFromData(armyData, count, amassMatch[0]), name: armyName }
          : {
              count,
              power: '0', toughness: '0',
              colors: ['black'], name: armyName,
              types: ['creature'], keywords: [],
              rawText: amassMatch[0],
            };
        const key = `${def.name}-amass`;
        if (!seen.has(key)) {
          seen.add(key);
          tokens.push(def);
        }
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
      def.conditionKey = `${card.name}-fabricate-${conditionCounter++}`;
      def.condition = 'Servo tokens';
      def.conditionType = 'modal';
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

    // Afterlife: "afterlife N" — when this creature dies, create N 1/1 white and black Spirit tokens with flying
    const afterlifeMatch = ability.match(/\bafterlife\s+(\d+)/i);
    if (afterlifeMatch && !existingNames.has('spirit')) {
      const count = parseInt(afterlifeMatch[1], 10);
      const spiritData = tokenData.find(t => t.name.toLowerCase() === 'spirit');
      const def: TokenDefinition = spiritData
        ? buildTokenDefFromData(spiritData, count, afterlifeMatch[0])
        : {
            count,
            power: '1', toughness: '1',
            colors: ['white', 'black'], name: 'Spirit',
            types: ['creature'], keywords: ['flying'],
            rawText: afterlifeMatch[0],
          };
      const key = `${def.name}-afterlife`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(def);
      }
    }

    // Investigate: creates a Clue artifact token
    // "investigate" / "investigate twice" / "investigate X times"
    if (/\binvestigate\b/i.test(ability) && !existingNames.has('clue')) {
      const timesMatch = ability.match(/\binvestigate\s+(\w+)\s+times?\b/i);
      let count = 1;
      if (timesMatch) {
        const word = timesMatch[1].toLowerCase();
        count = WORD_TO_NUM[word] ?? parseInt(word, 10);
        if (isNaN(count)) count = -1;
      }
      const clueData = tokenData.find(t => t.name.toLowerCase() === 'clue');
      const def: TokenDefinition = clueData
        ? buildTokenDefFromData(clueData, count, 'investigate')
        : {
            count,
            power: '', toughness: '',
            colors: ['colorless'], name: 'Clue',
            types: ['artifact'], keywords: [],
            rawText: 'investigate',
          };
      if (!seen.has('clue-investigate')) {
        seen.add('clue-investigate');
        tokens.push(def);
      }
    }

    // Populate: create a token that's a copy of a creature token you control
    if (/\bpopulate\b/i.test(ability) && !seen.has('populate')) {
      seen.add('populate');
      tokens.push({
        count: 1,
        power: '', toughness: '',
        colors: [], name: 'Copy of creature token',
        types: ['creature'], keywords: [],
        rawText: 'populate',
        isConditional: true,
        conditionKey: `${card.name}-populate-${conditionCounter++}`,
        condition: 'Populate (copy a creature token)',
        conditionType: 'board-state',
      });
    }
  }

  // Post-process: pair replacement tokens ("create Y instead") with their base tokens ("create X").
  // These are mutually exclusive — only one fires per trigger resolution.
  // Group them with -or- conditionKeys so the sliding switch UI renders correctly,
  // and so the base token is NOT created unconditionally (e.g. Ocelot Pride).
  {
    const replacementTokens = tokens.filter(t => t.isReplacement && t.isConditional);
    // Base tokens: anything that isn't itself a replacement (may already be conditional
    // from an "if it's your turn" or similar trigger qualifier — that gets overwritten below)
    const baseTokens = tokens.filter(t => !t.isReplacement);
    for (let i = 0; i < Math.min(replacementTokens.length, baseTokens.length); i++) {
      const base = baseTokens[i];
      const repl = replacementTokens[i];
      base.isConditional = true;
      base.conditionKey = `${card.name}-or-${conditionCounter++}`;
      base.condition = base.name;
      base.conditionType = 'activated-choice';
      repl.conditionKey = `${card.name}-or-${conditionCounter++}`;
      repl.conditionType = 'activated-choice';
    }
  }

  // If we found no tokens from text but have Scryfall token data and the card
  // mentions tokens, try matching directly (skip replacement-effect cards)
  if (tokens.length === 0 && tokenData.length > 0 && /token/i.test(oracleText) && !isReplacementEffect) {
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
