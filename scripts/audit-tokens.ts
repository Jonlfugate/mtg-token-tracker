/**
 * Token Detector Audit Script
 *
 * Usage:  npx tsx scripts/audit-tokens.ts
 *
 * What it does:
 *  1. Fetches every unique token card from Scryfall (ground truth)
 *  2. Downloads the full Scryfall oracle bulk data (~28 MB)
 *  3. Filters to token-relevant cards
 *  4. Runs each card through detectTokens()
 *  5. Cross-checks detected tokens against Scryfall token cards
 *  6. Reports: misses, wrong P/T/colors, unknown tokens, and uncovered token types
 */

import { detectTokens } from '../src/services/tokenDetector.ts';
import type { ScryfallCard, ScryfallTokenData, TokenDefinition } from '../src/types.ts';

const DELAY_MS = 110; // Scryfall asks for ≤10 req/s
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Color normalization ──────────────────────────────────────────────────────

const LETTER_TO_WORD: Record<string, string> = {
  W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green',
};
const WORD_TO_LETTER: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  W: 'W', U: 'U', B: 'B', R: 'R', G: 'G',
};

function toWord(c: string): string { return LETTER_TO_WORD[c] ?? c.toLowerCase(); }
function toLetter(c: string): string { return WORD_TO_LETTER[c.toLowerCase()] ?? c[0].toUpperCase(); }

// ─── Token key helpers ────────────────────────────────────────────────────────

/** Stable key: "name|power|toughness|sorted-color-letters" */
function makeKey(name: string, power: string, toughness: string, colors: string[]): string {
  return `${name.toLowerCase()}|${power}|${toughness}|${colors.map(toLetter).sort().join('')}`;
}

function scryfallTokenToKey(t: ScryfallTokenData): string {
  // Scryfall colors are uppercase letters (W/U/B/R/G)
  return makeKey(t.name, t.power ?? '', t.toughness ?? '', t.colors.map(toWord));
}

function detectedDefToKey(d: TokenDefinition): string {
  return makeKey(d.name, d.power, d.toughness, d.colors);
}

// ─── Scryfall fetch helpers ───────────────────────────────────────────────────

async function fetchAllPages<T>(initialUrl: string, label: string): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = initialUrl;
  let page = 1;
  while (url) {
    await sleep(DELAY_MS);
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) break;
      throw new Error(`${label} fetch failed: ${res.status}`);
    }
    const data = await res.json() as { data: T[]; has_more: boolean; next_page?: string };
    results.push(...data.data);
    process.stdout.write(`\r  ${label}: page ${page} — ${results.length} items`);
    url = data.has_more && data.next_page ? data.next_page : null;
    page++;
  }
  console.log();
  return results;
}

async function fetchAllTokenCards(): Promise<ScryfallTokenData[]> {
  console.log('\nFetching all token cards from Scryfall...');
  // unique=card deduplicates by oracle identity; exclude emblems
  const [regularTokens, landTokens] = await Promise.all([
    fetchAllPages<Record<string, unknown>>(
      'https://api.scryfall.com/cards/search?q=type:token+-type:emblem&unique=card&order=name',
      'tokens'
    ),
    fetchAllPages<Record<string, unknown>>(
      'https://api.scryfall.com/cards/search?q=type:token+type:land&unique=card&order=name',
      'land tokens'
    ),
  ]);
  // Merge and deduplicate by scryfall id
  const seen = new Set<string>();
  const raw: Record<string, unknown>[] = [];
  for (const c of [...regularTokens, ...landTokens]) {
    const id = c['id'] as string;
    if (!seen.has(id)) { seen.add(id); raw.push(c); }
  }
  return raw.map(c => ({
    name: c['name'] as string,
    power: c['power'] as string | undefined,
    toughness: c['toughness'] as string | undefined,
    // Scryfall returns colors as uppercase letter arrays; convert to words for our types
    colors: ((c['colors'] as string[]) ?? []).map(toWord),
    type_line: c['type_line'] as string,
    keywords: (c['keywords'] as string[]) ?? [],
    oracle_text: c['oracle_text'] as string | undefined,
  }));
}

async function fetchBulkOracleCards(): Promise<Record<string, unknown>[]> {
  console.log('\nFetching Scryfall bulk data index...');
  await sleep(DELAY_MS);
  const indexRes = await fetch('https://api.scryfall.com/bulk-data');
  const index = await indexRes.json() as { data: Array<{ type: string; download_uri: string }> };
  const entry = index.data.find(d => d.type === 'oracle_cards');
  if (!entry) throw new Error('Could not find oracle_cards bulk entry');
  console.log('Downloading oracle bulk data (~28 MB, this takes a moment)...');
  const dataRes = await fetch(entry.download_uri);
  const cards = await dataRes.json() as Record<string, unknown>[];
  console.log(`Downloaded ${cards.length.toLocaleString()} cards.`);
  return cards;
}

// ─── Card text helpers ────────────────────────────────────────────────────────

function getFullText(raw: Record<string, unknown>): string {
  if (raw['oracle_text']) return raw['oracle_text'] as string;
  const faces = raw['card_faces'] as Array<{ oracle_text?: string }> | undefined;
  return (faces ?? []).map(f => f.oracle_text ?? '').join('\n');
}

function rawToScryfallCard(raw: Record<string, unknown>): ScryfallCard {
  return {
    id: raw['id'] as string,
    name: raw['name'] as string,
    oracle_text: (raw['oracle_text'] as string) ?? '',
    mana_cost: (raw['mana_cost'] as string) ?? '',
    type_line: (raw['type_line'] as string) ?? '',
    card_faces: raw['card_faces'] as ScryfallCard['card_faces'],
    all_parts: raw['all_parts'] as ScryfallCard['all_parts'],
    colors: raw['colors'] as string[] | undefined,
    keywords: raw['keywords'] as string[] | undefined,
    power: raw['power'] as string | undefined,
    toughness: raw['toughness'] as string | undefined,
  };
}

// ─── Filters ──────────────────────────────────────────────────────────────────

// Matches any card that creates persistent tokens (oracle_text includes reminder text).
// Excludes myriad/encore — those tokens are exiled at end of combat and don't persist.
const CREATES_TOKENS_RE =
  /(create[sd]?\s+.{0,80}?\btoken|\btoken\b.{0,40}would\s+be\s+created|\bwould\s+create\b.{0,40}token|\bamass\b|\bfabricate\b|\bincubate\b|\bafterlife\b|\bpopulate\b|\binvestigate\b)/i;

// Tokens created by these mechanics are exiled immediately — they don't stay on the battlefield.
const TRANSIENT_ONLY_RE =
  /exile (?:the )?(?:tokens?|cop(?:y|ies)) at (?:the )?(?:beginning of the next end step|end of combat)/i;

// Pure multipliers/redirectors (Doubling Season, Anointed Procession, etc.) — these
// never add a *new* token type, they only modify how many of other tokens are created.
// Cards that add an *additional* token ("plus an additional Squirrel token") are NOT
// replacement-only — they create a new persistent token and must be audited.
function isReplacementOnly(text: string): boolean {
  // Must have "would...instead" replacement trigger
  if (!/\bwould\b/i.test(text) || !/\binstead\b/i.test(text)) return false;
  // If the card adds an extra token on top of existing ones, it's a creator, not just a multiplier
  if (/\bplus\s+(?:an?\s+(?:additional\s+)?)(?:\S+\s+){0,8}token/i.test(text)) return false;
  // If the card says "instead create" it's actively generating tokens
  // EXCEPT "instead create one of each" / "instead create those tokens" — those are still pure replacement
  if (/\binstead\s+create\b/i.test(text) &&
      !/\binstead\s+create\s+(?:one\s+of\s+each|those\s+tokens)\b/i.test(text)) return false;
  // If any line has a direct create...token outside a "would/instead" context, it's a creator
  for (const line of text.split('\n')) {
    const lower = line.toLowerCase();
    if (/\bcreate[sd]?\b/.test(lower) && /\btoken\b/.test(lower) &&
        !/\bwould\b/.test(lower) && !/\binstead\b/.test(lower)) {
      return false;
    }
  }
  return true;
}

// ─── Match detected token against Scryfall token map ─────────────────────────

interface MatchResult {
  found: boolean;
  issues: string[];
}

// Token types out of scope (enchantment-only tokens like Role, Equipment, Aura)
const OUT_OF_SCOPE_TYPES = new Set([
  'role', 'equipment', 'aura', 'saga', 'vehicle', 'contraption',
]);

function isInScope(def: { name: string; types: string[] }): boolean {
  const nameLower = def.name.toLowerCase();
  if (OUT_OF_SCOPE_TYPES.has(nameLower)) return false;
  // Skip enchantment-only tokens (Role, Aura, etc.) — land creature tokens ARE in scope
  if (def.types.length > 0 && def.types.every(t => t === 'enchantment')) return false;
  return true;
}

function isTokenInScope(t: ScryfallTokenData): boolean {
  const nameLower = t.name.toLowerCase();
  if (OUT_OF_SCOPE_TYPES.has(nameLower)) return false;
  const typeLine = t.type_line.toLowerCase();
  const isCreature = typeLine.includes('creature');
  const isArtifact = typeLine.includes('artifact');
  const isLand = typeLine.includes('land');
  const isEnchantmentOnly = typeLine.includes('enchantment') && !isCreature && !isArtifact && !isLand;
  if (isEnchantmentOnly) return false;
  // Must be creature, artifact, or land token
  return isCreature || isArtifact || isLand;
}

function matchToken(
  def: TokenDefinition,
  tokenMap: Map<string, ScryfallTokenData>
): MatchResult {
  // Copy tokens and double-all effects are inherently valid — skip detail check
  if (
    def.name.toLowerCase().startsWith('copy of ') ||
    def.countMode === 'double-tokens' ||
    def.name === 'Copy of creature token' // populate
  ) {
    return { found: true, issues: [] };
  }

  // Skip out-of-scope token types
  if (!isInScope(def)) return { found: true, issues: [] };

  // Exact key match (name + P/T + colors all correct)
  const key = detectedDefToKey(def);
  if (tokenMap.has(key)) return { found: true, issues: [] };

  // Name-only match — found but with wrong details
  for (const t of tokenMap.values()) {
    if (t.name.toLowerCase() !== def.name.toLowerCase()) continue;

    const issues: string[] = [];

    // Only flag P/T as wrong if BOTH sides have a concrete value (not empty/variable)
    const detectedPT = `${def.power}/${def.toughness}`;
    const actualPT = `${t.power ?? ''}/${t.toughness ?? ''}`;
    const detectedHasPT = def.power !== '' && def.toughness !== '' && def.power !== '*' && def.toughness !== '*';
    const actualHasPT = t.power != null && t.toughness != null && t.power !== '*' && t.toughness !== '*';
    if (detectedHasPT && actualHasPT && detectedPT !== actualPT) {
      issues.push(`P/T: detected ${detectedPT}, actual ${actualPT}`);
    }

    // Only flag color as wrong if both sides are explicit and differ
    const actualColors = t.colors.slice().sort().join(',');
    const detectedColors = def.colors.map(c => LETTER_TO_WORD[c] ?? c.toLowerCase()).sort().join(',');
    if (t.colors.length > 0 && def.colors.length > 0 && actualColors !== detectedColors) {
      issues.push(`colors: detected [${detectedColors}], actual [${actualColors}]`);
    }

    return { found: true, issues };
  }

  // Not found at all
  return {
    found: false,
    issues: [`"${def.name}" (${def.power}/${def.toughness} [${def.colors.join(',')}]) not in Scryfall token list`],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [allTokens, bulkCards] = await Promise.all([
    fetchAllTokenCards(),
    fetchBulkOracleCards(),
  ]);

  // Build token lookup (unique by name+P/T+colors)
  const tokenMap = new Map<string, ScryfallTokenData>();
  const tokenNameMap = new Map<string, ScryfallTokenData[]>(); // for loose name matching
  for (const t of allTokens) {
    const key = scryfallTokenToKey(t);
    if (!tokenMap.has(key)) tokenMap.set(key, t);
    const nameKey = t.name.toLowerCase();
    if (!tokenNameMap.has(nameKey)) tokenNameMap.set(nameKey, []);
    tokenNameMap.get(nameKey)!.push(t);
  }
  console.log(`\nUnique token types in Scryfall: ${tokenMap.size}`);

  // Filter to Commander-legal cards only
  const commanderLegal = bulkCards.filter(c => {
    const leg = c['legalities'] as Record<string, string> | undefined;
    return leg?.['commander'] === 'legal';
  });
  console.log(`Commander-legal cards:             ${commanderLegal.length}`);

  // Filter to token-relevant cards
  const relevant = commanderLegal.filter(c => CREATES_TOKENS_RE.test(getFullText(c)));
  const replacementOnlyCards: string[] = [];
  const transientOnlyCards: string[] = [];
  const creatingCards = relevant.filter(c => {
    const text = getFullText(c);
    if (isReplacementOnly(text)) {
      replacementOnlyCards.push(c['name'] as string);
      return false;
    }
    // Skip cards that only create tokens that are immediately exiled (myriad, encore, etc.)
    if (TRANSIENT_ONLY_RE.test(text) && !/\bcreate[sd]?\b.{0,80}token(?!.{0,200}exile.{0,80}token)/si.test(text)) {
      transientOnlyCards.push(c['name'] as string);
      return false;
    }
    return true;
  });

  console.log(`Token-relevant cards:               ${relevant.length}`);
  console.log(`  Replacement/support (skip):        ${replacementOnlyCards.length}`);
  console.log(`  Transient tokens only (skip):      ${transientOnlyCards.length}`);
  console.log(`  Direct persistent creators (audit):${creatingCards.length}`);
  console.log('\nRunning audit...');

  // Audit
  const misses: string[] = [];
  const wrongDetails: string[] = [];
  const unknownTokens: string[] = [];
  const producedKeys = new Set<string>();
  let passCount = 0;

  for (const raw of creatingCards) {
    const card = rawToScryfallCard(raw);
    const detected = detectTokens(card, allTokens);

    if (detected.length === 0) {
      const snippet = getFullText(raw).replace(/\n/g, ' ').slice(0, 140);
      misses.push(`${card.name}\n    "${snippet}"`);
      continue;
    }

    let cardPass = true;
    for (const def of detected) {
      const key = detectedDefToKey(def);
      producedKeys.add(key);

      const { found, issues } = matchToken(def, tokenMap);
      if (!found) {
        unknownTokens.push(`${card.name} → "${def.name}" (${def.power}/${def.toughness} [${def.colors.join(',')}])`);
        cardPass = false;
      } else if (issues.length > 0) {
        wrongDetails.push(`${card.name} → "${def.name}": ${issues.join('; ')}`);
        cardPass = false;
      }
    }
    if (cardPass) passCount++;
  }

  // Tokens that no card ever produces (in-scope only)
  const neverProduced = [...tokenMap.values()]
    .filter(t => isTokenInScope(t) && !producedKeys.has(scryfallTokenToKey(t)))
    .map(t => `${t.name} (${t.power ?? '?'}/${t.toughness ?? '?'} [${t.colors.join(',')}])`);

  // ─── Report ────────────────────────────────────────────────────────────────
  const divider = '═'.repeat(60);
  console.log('\n' + divider);
  console.log(' AUDIT REPORT');
  console.log(divider);
  console.log(`Scryfall unique token types:            ${tokenMap.size}`);
  console.log(`Cards checked (persistent creators):    ${creatingCards.length}`);
  console.log(`  PASS  (correct):                      ${passCount}`);
  console.log(`  MISS  (not detected at all):          ${misses.length}`);
  console.log(`  WRONG (bad P/T or colors):            ${wrongDetails.length}`);
  console.log(`  UNKNOWN (token not in Scryfall):      ${unknownTokens.length}`);
  console.log(`Tokens never produced by any card:      ${neverProduced.length}`);
  console.log(divider);

  if (misses.length) {
    console.log(`\n── MISSES (${misses.length}) ${'─'.repeat(40)}`);
    misses.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
  }

  if (wrongDetails.length) {
    console.log(`\n── WRONG DETAILS (${wrongDetails.length}) ${'─'.repeat(35)}`);
    wrongDetails.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
  }

  if (unknownTokens.length) {
    console.log(`\n── UNKNOWN TOKENS (${unknownTokens.length}) ${'─'.repeat(34)}`);
    unknownTokens.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  }

  if (neverProduced.length) {
    console.log(`\n── TOKENS NEVER PRODUCED (${neverProduced.length}) ${'─'.repeat(27)}`);
    neverProduced.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  }

  console.log('\n' + divider);
  const total = misses.length + wrongDetails.length + unknownTokens.length;
  console.log(` Total issues: ${total}  |  Pass rate: ${((passCount / creatingCards.length) * 100).toFixed(1)}%`);
  console.log(divider + '\n');
}

main().catch(err => {
  console.error('\nAudit failed:', err);
  process.exit(1);
});
