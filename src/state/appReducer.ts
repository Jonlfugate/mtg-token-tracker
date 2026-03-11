import type { AppState, BattlefieldCard, DeckCard, HistoryEntry, StandaloneToken, TokenCalculationResult } from '../types';
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

/**
 * Filter tokens based on per-token conditions:
 * - For tokens with isConditional: only include if that token's condition is met
 * - For non-conditional tokens: exclude if a replacement ("instead") token is active
 */
function getActiveTokens(card: DeckCard, conditionsMet: Record<string, boolean>): DeckCard {
  if (!hasCondition(card)) return card;

  const hasActiveReplacement = card.tokens.some(t => t.isReplacement && conditionsMet[t.name]);

  const filteredTokens = card.tokens.filter(t => {
    if (t.isConditional) {
      return conditionsMet[t.name] ?? false;
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
    !card.triggerInfo // no detected trigger = one-shot effect
  );
}

/** Convert TokenCalculationResults into StandaloneTokens */
function createStandaloneTokens(
  results: TokenCalculationResult[],
  sourceName: string,
  deckCardIndex: number,
  currentTurn: number,
): StandaloneToken[] {
  return results.map(calc => ({
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
  | { type: 'PLAY_CARD'; payload: { deckCardIndex: number; xValue?: number; quantity?: number } }
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
  | { type: 'LOAD_STATE'; payload: AppState };

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
      const { deckCardIndex, xValue, quantity = 1 } = action.payload;
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
        newCards.push({ instanceId: crypto.randomUUID(), deckCardIndex, xValue });
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
      const activeCard = resolveActiveCard(deckCard, bc?.conditionsMet ?? {}, state.battlefield, deckCardIndex);
      const supportCards = getSupportCards(state);
      const results = calculateTokens(activeCard, supportCards, xValue ?? 1);
      const newTokens = createStandaloneTokens(results, deckCard.scryfallData.name, deckCardIndex, state.currentTurn);

      return {
        ...state,
        standaloneTokens: [...state.standaloneTokens, ...newTokens],
        pendingPopulate: state.pendingPopulate + (deckCard.hasPopulate ? 1 : 0),
        undoStack,
        history: addHistory(state, `Triggered ${deckCard.scryfallData.name}`),
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

        const activeCard = resolveActiveCard(card, bc.conditionsMet ?? {}, state.battlefield, bc.deckCardIndex);
        if (activeCard.tokens.some(t => t.count === -1)) {
          xTriggerQueue.push(bc.deckCardIndex);
          continue;
        }

        const results = calculateTokens(activeCard, supportCards);
        allNewTokens.push(...createStandaloneTokens(results, card.scryfallData.name, bc.deckCardIndex, state.currentTurn));
      }

      // Also trigger copy tokens that are copies of cards with matching trigger types
      for (const token of state.standaloneTokens) {
        if (token.copyOfDeckIndex === undefined) continue;
        const originalCard = state.deckCards[token.copyOfDeckIndex];
        if (!originalCard || !originalCard.triggerInfo || !triggerTypes.includes(originalCard.triggerInfo.type)) continue;

        const bc = state.battlefield.find(b => b.deckCardIndex === token.copyOfDeckIndex);
        const activeCard = resolveActiveCard(originalCard, bc?.conditionsMet ?? {}, state.battlefield, token.copyOfDeckIndex);
        if (activeCard.tokens.some(t => t.count === -1)) continue;

        for (let i = 0; i < token.finalCount; i++) {
          const results = calculateTokens(activeCard, supportCards);
          allNewTokens.push(...createStandaloneTokens(
            results,
            `Copy of ${originalCard.scryfallData.name}`,
            token.copyOfDeckIndex,
            state.currentTurn,
          ));
        }
      }

      // Count populate triggers
      const populateCount = state.battlefield.filter(bc => {
        const card = state.deckCards[bc.deckCardIndex];
        return card.hasPopulate && card.triggerInfo && triggerTypes.includes(card.triggerInfo.type);
      }).length;

      if (allNewTokens.length === 0 && populateCount === 0 && xTriggerQueue.length === 0) return state;

      const label = triggerTypes.includes('landfall') ? 'Land played' : `New turn (Turn ${state.currentTurn})`;

      return {
        ...state,
        standaloneTokens: [...state.standaloneTokens, ...allNewTokens],
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
        undoStack,
        history: addHistory(state, 'Cleared battlefield'),
      };
    }

    case 'NEW_TURN':
      return {
        ...state,
        currentTurn: state.currentTurn + 1,
        history: addHistory(state, `Turn ${state.currentTurn + 1} started`),
      };

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

    default:
      return state;
  }
}
