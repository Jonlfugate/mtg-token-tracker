import type { AppState, BattlefieldCard, DeckCard, HistoryEntry, StandaloneToken, TokenCalculationResult, TokenDefinition } from '../types';
import { calculateTokens } from '../services/tokenCalculator';
import { isInstantOrSorcery, isTokenGenerator, isCopyToken } from '../services/cardUtils';

// --- Helpers ---

const MAX_UNDO = 50;

function pushUndo(state: AppState): AppState[] {
  const snapshot = { ...state, undoStack: [] };
  const stack = [...state.undoStack, snapshot];
  if (stack.length > MAX_UNDO) stack.shift();
  return stack;
}

function addHistory(state: AppState, label: string): HistoryEntry[] {
  return [...state.history, { label, turn: state.currentTurn, timestamp: Date.now() }];
}

/** Get all support/both cards currently on the battlefield */
function getSupportCards(state: AppState): DeckCard[] {
  return state.battlefield
    .map(bc => state.deckCards[bc.deckCardIndex])
    .filter(c => c.category === 'support' || c.category === 'both');
}

/** Check if a card has any conditional tokens */
function hasCondition(card: DeckCard): boolean {
  return card.tokens.some(t => t.isConditional);
}

/** Get the toggle key for a conditional token */
function getConditionKey(t: { conditionKey?: string; name: string }): string {
  return t.conditionKey || t.name;
}

/**
 * Filter tokens based on per-token conditions:
 * - For tokens with isConditional: only include if that token's condition is met
 * - For non-conditional tokens: exclude if a replacement ("instead") token is active
 * - For modal/activated-choice: only the last-toggled option is active (mutual exclusivity)
 */
function getActiveTokens(card: DeckCard, conditionsMet: Record<string, boolean>): DeckCard {
  if (!hasCondition(card)) return card;

  const hasActiveReplacement = card.tokens.some(t => t.isReplacement && conditionsMet[getConditionKey(t)]);

  // For mutual-exclusivity types (modal, activated-choice), only allow one active at a time.
  // If multiple are toggled on, keep only the last one found.
  const exclusiveTypes = new Set(['modal', 'activated-choice']);
  const activeExclusiveKey = (() => {
    const exclusiveTokens = card.tokens.filter(t => t.conditionType && exclusiveTypes.has(t.conditionType));
    if (exclusiveTokens.length <= 1) return null; // no mutual exclusivity needed
    const active = exclusiveTokens.filter(t => conditionsMet[getConditionKey(t)]);
    if (active.length <= 1) return null; // 0 or 1 active, no conflict
    // Multiple active — keep only the last one
    return getConditionKey(active[active.length - 1]);
  })();

  // For base/replacement pairs (conditionKey pattern: "{card}-or-N"), if neither option
  // is explicitly selected the base token fires by default (e.g. Spirit before Monarch toggle).
  const defaultToBase = new Set<string>();
  {
    const orGroups = new Map<string, { base?: TokenDefinition; replacement?: TokenDefinition }>();
    for (const t of card.tokens) {
      const key = getConditionKey(t);
      const m = key.match(/^(.+-or)-\d+$/);
      if (m) {
        if (!orGroups.has(m[1])) orGroups.set(m[1], {});
        const g = orGroups.get(m[1])!;
        if (t.isReplacement) g.replacement = t; else g.base = t;
      }
    }
    for (const g of orGroups.values()) {
      if (g.base && g.replacement) {
        const baseKey = getConditionKey(g.base);
        const replKey = getConditionKey(g.replacement);
        if (!conditionsMet[baseKey] && !conditionsMet[replKey]) {
          defaultToBase.add(baseKey);
        }
      }
    }
  }

  const filteredTokens = card.tokens.filter(t => {
    if (t.isConditional) {
      const key = getConditionKey(t);
      const isActive = conditionsMet[key] ?? false;
      // If this is a mutual-exclusivity type and another was selected, deactivate
      if (activeExclusiveKey && t.conditionType && exclusiveTypes.has(t.conditionType) && key !== activeExclusiveKey) {
        return false;
      }
      return isActive || defaultToBase.has(key);
    }
    if (hasActiveReplacement) {
      return false;
    }
    return true;
  });

  return { ...card, tokens: filteredTokens };
}

/**
 * Resolve self-copies countMode by calculating token count from battlefield state.
 * Also applies condition filtering.
 */
function resolveActiveCard(
  card: DeckCard,
  conditionsMet: Record<string, boolean>,
  battlefield: BattlefieldCard[],
  deckCardIndex: number,
  counters?: number,
): DeckCard {
  let activeCard = getActiveTokens(card, conditionsMet);

  if (activeCard.tokens.some(t => t.countMode === 'self-copies')) {
    const inPlay = battlefield.filter(b => b.deckCardIndex === deckCardIndex).length;
    activeCard = {
      ...activeCard,
      tokens: activeCard.tokens.map(t =>
        t.countMode === 'self-copies' ? { ...t, count: Math.max(0, inPlay - 1) } : t
      ),
    };
  }

  if (counters !== undefined && activeCard.tokens.some(t => t.countMode === 'counters')) {
    activeCard = {
      ...activeCard,
      tokens: activeCard.tokens.map(t =>
        t.countMode === 'counters' ? { ...t, count: counters } : t
      ),
    };
  }

  return activeCard;
}

/** Check if tokens should be created immediately when a card is played */
function shouldTriggerOnPlay(card: DeckCard): boolean {
  if (!isTokenGenerator(card)) return false;
  // Modal cards (all tokens conditional) skip auto-create so the player can choose
  if (card.tokens.length > 0 && card.tokens.every(t => t.isConditional)) return false;
  return (
    isInstantOrSorcery(card) ||
    card.triggerInfo?.type === 'etb' ||
    card.triggerInfo?.alsoEtb === true ||
    (!card.triggerInfo && card.supportEffects.length === 0) // no trigger + no support = one-shot effect
  );
}

/** Standard artifact token definitions for Academy Manufactor */
const ARTIFACT_TOKEN_DEFS: Record<string, TokenDefinition> = {
  treasure: { count: 1, power: '', toughness: '', colors: [], name: 'Treasure', types: ['artifact'], keywords: [], rawText: 'Treasure token' },
  clue: { count: 1, power: '', toughness: '', colors: [], name: 'Clue', types: ['artifact'], keywords: [], rawText: 'Clue token' },
  food: { count: 1, power: '', toughness: '', colors: [], name: 'Food', types: ['artifact'], keywords: [], rawText: 'Food token' },
};
const MANUFACTOR_TOKEN_NAMES = new Set(['treasure', 'clue', 'food']);

/**
 * Create companion tokens whenever other tokens are created.
 * Handles two patterns:
 * - Academy Manufactor: replaces each Clue/Food/Treasure with one of each
 *   (processed first; multiple Manufactors stack per MTG rules)
 * - Chatterfang: creates Squirrels equal to total tokens created
 *   (processed after Manufactors so Squirrel count includes Manufactor output)
 */
function createCompanionTokens(
  state: AppState,
  newTokens: StandaloneToken[],
  sourceCardIndex?: number,
): StandaloneToken[] {
  if (newTokens.length === 0) return [];

  // Non-companion support cards for multiplier calculations
  const supportCards = state.battlefield
    .map(b => state.deckCards[b.deckCardIndex])
    .filter(c => (c.category === 'support' || c.category === 'both')
      && !c.supportEffects.some(e => e.type === 'companion'));

  // Separate Manufactor-type and Chatterfang-type companions
  const manufactors: BattlefieldCard[] = [];
  const chatterfangs: BattlefieldCard[] = [];

  for (const bc of state.battlefield) {
    const card = state.deckCards[bc.deckCardIndex];
    if (!card.supportEffects.some(e => e.type === 'companion')) continue;
    if (bc.deckCardIndex === sourceCardIndex) continue;

    const oracleText = card.scryfallData.oracle_text?.toLowerCase() ?? '';
    if (/instead\s+create\s+one\s+of\s+each/i.test(oracleText)) {
      manufactors.push(bc);
    } else {
      chatterfangs.push(bc);
    }
  }

  // --- Phase 1: Academy Manufactor stacking ---
  // Each Manufactor replaces every Clue/Food/Treasure with one of each.
  // Multiple Manufactors stack: each subsequent one processes the output of the previous.
  // Per MTG rulings: 2 Manufactors + 1 Treasure = 3 Treasure + 3 Clue + 3 Food (9 total).
  let manufactorTokens: StandaloneToken[] = [];
  // Track all artifact tokens (originals + generated) for iterative processing
  let artifactPool = newTokens.filter(t => MANUFACTOR_TOKEN_NAMES.has(t.tokenDef.name.toLowerCase()));

  for (const bc of manufactors) {
    const card = state.deckCards[bc.deckCardIndex];
    const batchTokens: StandaloneToken[] = [];

    for (const token of artifactPool) {
      const tokenName = token.tokenDef.name.toLowerCase();
      if (!MANUFACTOR_TOKEN_NAMES.has(tokenName)) continue;

      // Create the two missing artifact token types.
      // Manufactor is a replacement effect — it applies at the same time as multipliers
      // (Doubling Season, etc.), so the companion count matches the triggering token's
      // final count directly. Do NOT re-apply support effects here; that would double
      // the multipliers since they were already applied when calculating the original token.
      for (const [name, def] of Object.entries(ARTIFACT_TOKEN_DEFS)) {
        if (name === tokenName) continue; // already being created
        const art = card.tokenArt.find(a => a.name.toLowerCase() === name)
          || card.tokenArt.find(a => a.name.toLowerCase().includes(name) || name.includes(a.name.toLowerCase()));
        batchTokens.push({
          id: crypto.randomUUID(),
          tokenDef: { ...def },
          tokenArt: art ?? undefined,
          finalCount: token.finalCount,
          breakdown: `${token.finalCount} (Academy Manufactor)`,
          sourceName: card.scryfallData.name,
          createdOnTurn: state.currentTurn,
        });
      }
    }

    manufactorTokens.push(...batchTokens);
    // Next Manufactor processes both the original pool AND this Manufactor's output
    artifactPool = [...artifactPool, ...batchTokens.filter(t => MANUFACTOR_TOKEN_NAMES.has(t.tokenDef.name.toLowerCase()))];
  }

  // --- Phase 2: Chatterfang-type companions ---
  // Squirrel count is based on ALL tokens created (original + Manufactor output)
  const allTokensSoFar = [...newTokens, ...manufactorTokens];
  const chatterfangTokens: StandaloneToken[] = [];

  for (const bc of chatterfangs) {
    const card = state.deckCards[bc.deckCardIndex];
    if (card.tokens.length === 0) continue;

    const totalTokensCreated = allTokensSoFar.reduce((sum, t) => sum + t.finalCount, 0);
    const companionCard: DeckCard = {
      ...card,
      tokens: [{ ...card.tokens[0], count: totalTokensCreated }],
    };
    const results = calculateTokens(companionCard, supportCards);
    chatterfangTokens.push(...createStandaloneTokens(
      results,
      card.scryfallData.name,
      bc.deckCardIndex,
      state.currentTurn,
    ));
  }

  return [...manufactorTokens, ...chatterfangTokens];
}

/** Convert TokenCalculationResults into StandaloneTokens (filters out zero-count tokens) */
function createStandaloneTokens(
  results: TokenCalculationResult[],
  sourceName: string,
  deckCardIndex: number,
  currentTurn: number,
): StandaloneToken[] {
  return results
    .filter(calc => calc.finalCount > 0)
    .map(calc => ({
      id: crypto.randomUUID(),
      tokenDef: calc.baseTokens,
      tokenArt: isCopyToken(calc.baseTokens) ? undefined : calc.tokenArt,
      finalCount: calc.finalCount,
      breakdown: calc.breakdown,
      sourceName,
      copyOfDeckIndex: isCopyToken(calc.baseTokens) ? deckCardIndex : undefined,
      createdOnTurn: currentTurn,
    }));
}

// --- Action types ---

export type AppAction =
  | { type: 'SET_RAW_DECKLIST'; payload: string }
  | { type: 'IMPORT_START'; payload: { total: number } }
  | { type: 'FETCH_PROGRESS'; payload: { done: number; total: number } }
  | { type: 'IMPORT_COMPLETE'; payload: DeckCard[] }
  | { type: 'IMPORT_ERROR'; payload: string }
  | { type: 'PLAY_CARD'; payload: { deckCardIndex: number; xValue?: number; quantity?: number; counters?: number } }
  | { type: 'REMOVE_CARD'; payload: { instanceId: string } }
  | { type: 'TRIGGER_CARD'; payload: { deckCardIndex: number; xValue?: number } }
  | { type: 'TRIGGER_ALL'; payload: { triggerTypes: string[] } }
  | { type: 'TOGGLE_CONDITION'; payload: { instanceId: string; tokenName: string } }
  | { type: 'REMOVE_STANDALONE_TOKEN'; payload: { id: string } }
  | { type: 'ADJUST_TOKEN'; payload: { id: string; delta: number } }
  | { type: 'RESOLVE_POPULATE' }
  | { type: 'CANCEL_POPULATE' }
  | { type: 'SHIFT_X_TRIGGER' }
  | { type: 'NEW_TURN' }
  | { type: 'CLEAR_ALL_TOKENS' }
  | { type: 'CLEAR_TURN_TOKENS' }
  | { type: 'CLEAR_BATTLEFIELD' }
  | { type: 'RESET' }
  | { type: 'UNDO' }
  | { type: 'LOAD_STATE'; payload: AppState }
  | { type: 'REMOVE_ALL_INSTANCES'; payload: { deckCardIndex: number } }
  | { type: 'ADD_CARD'; payload: DeckCard }
  | { type: 'KILL_TOKEN'; payload: { id: string } }
  | { type: 'LOAD_SAVED_DECK'; payload: { deckCards: DeckCard[]; rawDecklist: string } };

export const initialState: AppState = {
  rawDecklist: '',
  deckCards: [],
  battlefield: [],
  standaloneTokens: [],
  currentTurn: 1,
  pendingPopulate: 0,
  pendingXTriggers: [],
  importStatus: 'idle',
  fetchProgress: { done: 0, total: 0 },
  history: [],
  undoStack: [],
  tokenDeaths: {},
};

// --- Reducer ---

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_RAW_DECKLIST':
      return { ...state, rawDecklist: action.payload };

    case 'IMPORT_START':
      return {
        ...state,
        importStatus: 'fetching',
        fetchProgress: { done: 0, total: action.payload.total },
        deckCards: [],
        battlefield: [],
        standaloneTokens: [],
        error: undefined,
        history: [],
        undoStack: [],
      };

    case 'FETCH_PROGRESS':
      return { ...state, fetchProgress: action.payload };

    case 'IMPORT_COMPLETE':
      return {
        ...state,
        importStatus: 'done',
        deckCards: action.payload,
        fetchProgress: { done: action.payload.length, total: action.payload.length },
      };

    case 'IMPORT_ERROR':
      return { ...state, importStatus: 'error', error: action.payload };

    case 'PLAY_CARD': {
      const { deckCardIndex, xValue, quantity = 1, counters } = action.payload;
      const deckCard = state.deckCards[deckCardIndex];
      if (!deckCard) return state;

      const undoStack = pushUndo(state);
      const cardName = deckCard.scryfallData.name;
      const histLabel = quantity > 1 ? `Played ${quantity}x ${cardName}` : `Played ${cardName}`;

      let newStandaloneTokens = state.standaloneTokens;
      if (shouldTriggerOnPlay(deckCard)) {
        const supportCards = getSupportCards(state);
        const hasSelfCopies = deckCard.tokens.some(t => t.countMode === 'self-copies');

        if (hasSelfCopies) {
          const alreadyInPlay = state.battlefield.filter(b => b.deckCardIndex === deckCardIndex).length;
          const eachSees = alreadyInPlay + quantity - 1;
          const modifiedCard = {
            ...deckCard,
            tokens: deckCard.tokens.map(t =>
              t.countMode === 'self-copies' ? { ...t, count: eachSees } : t
            ),
          };
          for (let i = 0; i < quantity; i++) {
            const results = calculateTokens(modifiedCard, supportCards, xValue ?? 1);
            const newTokens = createStandaloneTokens(results, cardName, deckCardIndex, state.currentTurn);
            newStandaloneTokens = [...newStandaloneTokens, ...newTokens];
          }
        } else {
          const results = calculateTokens(deckCard, supportCards, xValue ?? 1);
          const newTokens = createStandaloneTokens(results, cardName, deckCardIndex, state.currentTurn);
          newStandaloneTokens = [...state.standaloneTokens, ...newTokens];
        }
      }

      // Create companion tokens (e.g., Chatterfang Squirrels)
      const justCreated = newStandaloneTokens.slice(state.standaloneTokens.length);
      const companionTokens = createCompanionTokens(state, justCreated, deckCardIndex);
      newStandaloneTokens = [...newStandaloneTokens, ...companionTokens];

      // Check if this card triggers populate on play
      const shouldPopulateNow = deckCard.hasPopulate && shouldTriggerOnPlay(deckCard);
      const populateAdd = shouldPopulateNow ? 1 : 0;

      // Instants/sorceries don't stay on the battlefield
      if (isInstantOrSorcery(deckCard)) {
        return {
          ...state,
          standaloneTokens: newStandaloneTokens,
          pendingPopulate: state.pendingPopulate + populateAdd,
          undoStack,
          history: addHistory(state, histLabel),
        };
      }

      // Permanents go to the battlefield
      const newCards: BattlefieldCard[] = [];
      for (let i = 0; i < quantity; i++) {
        newCards.push({ instanceId: crypto.randomUUID(), deckCardIndex, xValue, counters });
      }

      return {
        ...state,
        battlefield: [...state.battlefield, ...newCards],
        standaloneTokens: newStandaloneTokens,
        pendingPopulate: state.pendingPopulate + populateAdd,
        undoStack,
        history: addHistory(state, histLabel),
      };
    }

    case 'TRIGGER_CARD': {
      const { deckCardIndex, xValue } = action.payload;
      const deckCard = state.deckCards[deckCardIndex];
      if (!deckCard || !isTokenGenerator(deckCard)) return state;

      const undoStack = pushUndo(state);
      const bc = state.battlefield.find(b => b.deckCardIndex === deckCardIndex);
      const activeCard = resolveActiveCard(deckCard, bc?.conditionsMet ?? {}, state.battlefield, deckCardIndex, bc?.counters);

      // Handle "double all creature tokens" (e.g., Rhys the Redeemed's second ability)
      const hasDoubleTokens = activeCard.tokens.some(t => t.countMode === 'double-tokens');
      if (hasDoubleTokens) {
        const creatureTokens = state.standaloneTokens.filter(t => t.tokenDef.types.includes('creature'));
        if (creatureTokens.length === 0) return state;

        // Create a copy of each creature token with the same count
        const doubled: StandaloneToken[] = creatureTokens.map(t => ({
          id: crypto.randomUUID(),
          tokenDef: t.tokenDef,
          tokenArt: t.tokenArt,
          finalCount: t.finalCount,
          breakdown: `${t.finalCount} (copy of ${t.tokenDef.name})`,
          sourceName: deckCard.scryfallData.name,
          copyOfDeckIndex: t.copyOfDeckIndex,
          createdOnTurn: state.currentTurn,
        }));

        // Companion tokens (e.g., Chatterfang sees all the new copies)
        const companionTokens = createCompanionTokens(state, doubled, deckCardIndex);

        return {
          ...state,
          standaloneTokens: [...state.standaloneTokens, ...doubled, ...companionTokens],
          undoStack,
          history: addHistory(state, `Triggered ${deckCard.scryfallData.name} (doubled tokens)`),
        };
      }

      // Handle "copy of each token that entered this turn" (e.g., Ocelot Pride city's blessing)
      const hasCopyTurnTokens = activeCard.tokens.some(t => t.countMode === 'copy-turn-tokens');

      const supportCards = getSupportCards(state);
      // Exclude copy-turn-tokens entries from normal calculation — they drive their own logic
      const regularCard = hasCopyTurnTokens
        ? { ...activeCard, tokens: activeCard.tokens.filter(t => t.countMode !== 'copy-turn-tokens') }
        : activeCard;
      const results = calculateTokens(regularCard, supportCards, xValue ?? 1);
      const newTokens = createStandaloneTokens(results, deckCard.scryfallData.name, deckCardIndex, state.currentTurn);

      // Companion tokens for the newly created regular tokens
      const companionTokens = createCompanionTokens(state, newTokens, deckCardIndex);

      // Copy-turn-tokens: one copy of each token type that entered this turn,
      // including any tokens just created by this trigger.
      let copyTurnTokens: StandaloneToken[] = [];
      if (hasCopyTurnTokens) {
        const thisTurnSoFar = state.standaloneTokens.filter(t => t.createdOnTurn === state.currentTurn);
        const allThisTurn = [...thisTurnSoFar, ...newTokens, ...companionTokens];
        copyTurnTokens = allThisTurn.map(t => ({
          id: crypto.randomUUID(),
          tokenDef: t.tokenDef,
          tokenArt: t.tokenArt,
          finalCount: t.finalCount,
          breakdown: `${t.finalCount} (city's blessing copy)`,
          sourceName: deckCard.scryfallData.name,
          copyOfDeckIndex: t.copyOfDeckIndex,
          createdOnTurn: state.currentTurn,
        }));
      }

      return {
        ...state,
        standaloneTokens: [...state.standaloneTokens, ...newTokens, ...companionTokens, ...copyTurnTokens],
        pendingPopulate: state.pendingPopulate + (deckCard.hasPopulate ? 1 : 0),
        undoStack,
        history: addHistory(state, `Triggered ${deckCard.scryfallData.name}${hasCopyTurnTokens && copyTurnTokens.length > 0 ? ' + city\'s blessing copies' : ''}`),
      };
    }

    case 'TRIGGER_ALL': {
      const { triggerTypes } = action.payload;
      const undoStack = pushUndo(state);
      const supportCards = getSupportCards(state);
      const allNewTokens: StandaloneToken[] = [];
      const xTriggerQueue: number[] = [];

      // Trigger battlefield permanents
      for (const bc of state.battlefield) {
        const card = state.deckCards[bc.deckCardIndex];
        if (!isTokenGenerator(card) || !card.triggerInfo || !triggerTypes.includes(card.triggerInfo.type)) continue;

        const activeCard = resolveActiveCard(card, bc.conditionsMet ?? {}, state.battlefield, bc.deckCardIndex, bc.counters);
        if (activeCard.tokens.some(t => t.count === -1 && t.countMode !== 'counters')) {
          xTriggerQueue.push(bc.deckCardIndex);
          continue;
        }

        const results = calculateTokens(activeCard, supportCards);
        allNewTokens.push(...createStandaloneTokens(results, card.scryfallData.name, bc.deckCardIndex, state.currentTurn));
      }

      // Trigger copy tokens: group by source card so calculateTokens runs once per card type,
      // then scale by total copies. This avoids O(totalCopies) iterations for large token counts
      // (e.g., millions of Scute Swarm copies would otherwise call calculateTokens millions of times).
      const copyGroups = new Map<number, number>(); // deckCardIndex → total copy count
      for (const token of state.standaloneTokens) {
        if (token.copyOfDeckIndex === undefined) continue;
        copyGroups.set(token.copyOfDeckIndex, (copyGroups.get(token.copyOfDeckIndex) ?? 0) + token.finalCount);
      }
      for (const [deckCardIndex, totalCopies] of copyGroups) {
        const originalCard = state.deckCards[deckCardIndex];
        if (!originalCard || !originalCard.triggerInfo || !triggerTypes.includes(originalCard.triggerInfo.type)) continue;

        const bc = state.battlefield.find(b => b.deckCardIndex === deckCardIndex);
        const activeCard = resolveActiveCard(originalCard, bc?.conditionsMet ?? {}, state.battlefield, deckCardIndex);
        if (activeCard.tokens.some(t => t.count === -1)) continue;

        const results = calculateTokens(activeCard, supportCards);
        const perCopy = createStandaloneTokens(results, `Copy of ${originalCard.scryfallData.name}`, deckCardIndex, state.currentTurn);
        for (const t of perCopy) {
          allNewTokens.push({ ...t, finalCount: t.finalCount * totalCopies });
        }
      }

      // Count populate triggers
      const populateCount = state.battlefield.filter(bc => {
        const card = state.deckCards[bc.deckCardIndex];
        return card.hasPopulate && card.triggerInfo && triggerTypes.includes(card.triggerInfo.type);
      }).length;

      // Create companion tokens (e.g., Chatterfang Squirrels)
      const companionTokens = createCompanionTokens(state, allNewTokens);
      allNewTokens.push(...companionTokens);

      if (allNewTokens.length === 0 && populateCount === 0 && xTriggerQueue.length === 0) return state;

      const label = triggerTypes.includes('landfall') ? 'Land played' : `New turn (Turn ${state.currentTurn})`;

      // Consolidate tokens: merge entries with the same identity into one entry.
      // This prevents the standaloneTokens array from growing exponentially when copy tokens
      // (like Scute Swarm copies) repeatedly trigger and create more copies.
      // Key: name + P/T + copyOfDeckIndex + createdOnTurn (preserve per-turn granularity for "Clear This Turn").
      const consolidatedMap = new Map<string, StandaloneToken>();
      for (const t of state.standaloneTokens) {
        const key = `${t.tokenDef.name}|${t.tokenDef.power ?? ''}|${t.tokenDef.toughness ?? ''}|${t.copyOfDeckIndex ?? ''}|${t.createdOnTurn}`;
        const ex = consolidatedMap.get(key);
        if (ex) {
          consolidatedMap.set(key, { ...ex, finalCount: ex.finalCount + t.finalCount });
        } else {
          consolidatedMap.set(key, { ...t });
        }
      }
      for (const t of allNewTokens) {
        const key = `${t.tokenDef.name}|${t.tokenDef.power ?? ''}|${t.tokenDef.toughness ?? ''}|${t.copyOfDeckIndex ?? ''}|${t.createdOnTurn}`;
        const ex = consolidatedMap.get(key);
        if (ex) {
          consolidatedMap.set(key, { ...ex, finalCount: ex.finalCount + t.finalCount });
        } else {
          consolidatedMap.set(key, { ...t });
        }
      }

      return {
        ...state,
        standaloneTokens: Array.from(consolidatedMap.values()),
        pendingPopulate: state.pendingPopulate + populateCount,
        pendingXTriggers: [...state.pendingXTriggers, ...xTriggerQueue],
        undoStack,
        history: addHistory(state, label),
      };
    }

    case 'TOGGLE_CONDITION': {
      const { instanceId, tokenName } = action.payload;
      return {
        ...state,
        battlefield: state.battlefield.map(bc => {
          if (bc.instanceId !== instanceId) return bc;
          const prev = bc.conditionsMet ?? {};
          return { ...bc, conditionsMet: { ...prev, [tokenName]: !prev[tokenName] } };
        }),
      };
    }

    case 'REMOVE_CARD': {
      const undoStack = pushUndo(state);
      const bc = state.battlefield.find(b => b.instanceId === action.payload.instanceId);
      const cardName = bc ? state.deckCards[bc.deckCardIndex]?.scryfallData.name : 'card';
      return {
        ...state,
        battlefield: state.battlefield.filter(b => b.instanceId !== action.payload.instanceId),
        undoStack,
        history: addHistory(state, `Removed ${cardName}`),
      };
    }

    case 'REMOVE_STANDALONE_TOKEN': {
      const undoStack = pushUndo(state);
      const token = state.standaloneTokens.find(t => t.id === action.payload.id);
      return {
        ...state,
        standaloneTokens: state.standaloneTokens.filter(t => t.id !== action.payload.id),
        undoStack,
        history: addHistory(state, `Removed ${token?.tokenDef.name ?? 'token'} tokens`),
      };
    }

    case 'ADJUST_TOKEN': {
      const { id, delta } = action.payload;
      const token = state.standaloneTokens.find(t => t.id === id);
      if (!token) return state;
      const newCount = token.finalCount + delta;
      if (newCount <= 0) {
        return {
          ...state,
          standaloneTokens: state.standaloneTokens.filter(t => t.id !== id),
        };
      }
      return {
        ...state,
        standaloneTokens: state.standaloneTokens.map(t =>
          t.id === id ? { ...t, finalCount: newCount } : t
        ),
      };
    }

    case 'RESOLVE_POPULATE':
      return { ...state, pendingPopulate: Math.max(0, state.pendingPopulate - 1) };

    case 'CANCEL_POPULATE':
      return { ...state, pendingPopulate: 0 };

    case 'SHIFT_X_TRIGGER':
      return { ...state, pendingXTriggers: state.pendingXTriggers.slice(1) };

    case 'CLEAR_ALL_TOKENS': {
      if (state.standaloneTokens.length === 0) return state;
      const undoStack = pushUndo(state);
      return {
        ...state,
        standaloneTokens: [],
        undoStack,
        history: addHistory(state, 'Cleared all tokens'),
      };
    }

    case 'CLEAR_TURN_TOKENS': {
      const turnTokens = state.standaloneTokens.filter(t => t.createdOnTurn === state.currentTurn);
      if (turnTokens.length === 0) return state;
      const undoStack = pushUndo(state);
      return {
        ...state,
        standaloneTokens: state.standaloneTokens.filter(t => t.createdOnTurn !== state.currentTurn),
        undoStack,
        history: addHistory(state, `Cleared turn ${state.currentTurn} tokens`),
      };
    }

    case 'CLEAR_BATTLEFIELD': {
      if (state.battlefield.length === 0 && state.standaloneTokens.length === 0) return state;
      const undoStack = pushUndo(state);
      return {
        ...state,
        battlefield: [],
        standaloneTokens: [],
        pendingPopulate: 0,
        pendingXTriggers: [],
        tokenDeaths: {},
        undoStack,
        history: addHistory(state, 'Cleared battlefield'),
      };
    }

    case 'REMOVE_ALL_INSTANCES': {
      const { deckCardIndex } = action.payload;
      const undoStack = pushUndo(state);
      const cardName = state.deckCards[deckCardIndex]?.scryfallData.name ?? 'card';
      return {
        ...state,
        battlefield: state.battlefield.filter(b => b.deckCardIndex !== deckCardIndex),
        undoStack,
        history: addHistory(state, `Removed all ${cardName}`),
      };
    }

    case 'NEW_TURN': {
      const newBattlefield = state.battlefield.map(bc => {
        const card = state.deckCards[bc.deckCardIndex];
        if (!bc.conditionsMet || Object.keys(bc.conditionsMet).length === 0) return bc;
        const boardStateKeys = new Set(
          card.tokens
            .filter(t => t.conditionType === 'board-state')
            .map(t => t.conditionKey || t.name)
        );
        if (boardStateKeys.size === 0) return bc;
        const newConditions = { ...bc.conditionsMet };
        for (const key of boardStateKeys) {
          newConditions[key] = false;
        }
        return { ...bc, conditionsMet: newConditions };
      });
      return {
        ...state,
        battlefield: newBattlefield,
        currentTurn: state.currentTurn + 1,
        tokenDeaths: {},
        history: addHistory(state, `Turn ${state.currentTurn + 1} started`),
      };
    }

    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const prevState = state.undoStack[state.undoStack.length - 1];
      return {
        ...prevState,
        undoStack: state.undoStack.slice(0, -1),
        history: [...state.history, { label: 'Undo', turn: state.currentTurn, timestamp: Date.now() }],
      };
    }

    case 'RESET':
      return initialState;

    case 'LOAD_STATE':
      return action.payload;

    case 'ADD_CARD': {
      const exists = state.deckCards.some(c => c.scryfallData.name === action.payload.scryfallData.name);
      if (exists) return state; // already in deck
      return { ...state, deckCards: [...state.deckCards, action.payload] };
    }

    case 'KILL_TOKEN': {
      const { id } = action.payload;
      const token = state.standaloneTokens.find(t => t.id === id);
      if (!token) return state;
      const undoStack = pushUndo(state);
      const name = token.tokenDef.name;
      const newCount = token.finalCount - 1;
      const newDeaths = { ...state.tokenDeaths, [name]: (state.tokenDeaths[name] ?? 0) + 1 };
      const newTokens = newCount <= 0
        ? state.standaloneTokens.filter(t => t.id !== id)
        : state.standaloneTokens.map(t => t.id === id ? { ...t, finalCount: newCount } : t);
      return { ...state, standaloneTokens: newTokens, tokenDeaths: newDeaths, undoStack };
    }

    case 'LOAD_SAVED_DECK': {
      const { deckCards, rawDecklist } = action.payload;
      return {
        ...initialState,
        importStatus: 'done',
        rawDecklist,
        deckCards,
        fetchProgress: { done: deckCards.length, total: deckCards.length },
      };
    }

    default:
      return state;
  }
}
