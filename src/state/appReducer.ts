import type { AppState, BattlefieldCard, DeckCard, HistoryEntry, StandaloneToken } from '../types';
import { calculateTokens } from '../services/tokenCalculator';

function isInstantOrSorcery(card: DeckCard): boolean {
  const type = card.scryfallData.type_line.toLowerCase();
  return type.includes('instant') || type.includes('sorcery');
}

function isTokenGenerator(card: DeckCard): boolean {
  return card.category === 'token-generator' || card.category === 'both';
}

function hasCondition(card: DeckCard): boolean {
  return card.tokens.some(t => t.isConditional);
}

// Filter tokens based on per-token conditions:
// - For tokens with isConditional: only include if that token's condition is met
// - For non-conditional tokens: exclude if a replacement ("instead") token is active
function getActiveTokens(card: DeckCard, conditionsMet: Record<string, boolean>): DeckCard {
  if (!hasCondition(card)) return card;

  // Check if any "instead" replacement is active
  const hasActiveReplacement = card.tokens.some(t => t.isReplacement && conditionsMet[t.name]);

  const filteredTokens = card.tokens.filter(t => {
    if (t.isConditional) {
      // Include conditional tokens only if their specific condition is toggled on
      return conditionsMet[t.name] ?? false;
    }
    // Non-conditional (default) tokens: exclude if a replacement is active
    // (e.g., Court of Grace's Spirit is replaced by Angel when monarch)
    if (hasActiveReplacement) {
      return false;
    }
    return true;
  });

  return { ...card, tokens: filteredTokens };
}

function isCopyToken(tokenDef: { name: string }): boolean {
  return tokenDef.name.toLowerCase().startsWith('copy of ');
}

const MAX_UNDO = 50;

function pushUndo(state: AppState): AppState[] {
  // Save state without undoStack to avoid nested stacks
  const snapshot = { ...state, undoStack: [] };
  const stack = [...state.undoStack, snapshot];
  if (stack.length > MAX_UNDO) stack.shift();
  return stack;
}

function addHistory(state: AppState, label: string): HistoryEntry[] {
  return [...state.history, { label, turn: state.currentTurn, timestamp: Date.now() }];
}

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
      return {
        ...state,
        fetchProgress: action.payload,
      };

    case 'IMPORT_COMPLETE':
      return {
        ...state,
        importStatus: 'done',
        deckCards: action.payload,
        fetchProgress: { done: action.payload.length, total: action.payload.length },
      };

    case 'IMPORT_ERROR':
      return {
        ...state,
        importStatus: 'error',
        error: action.payload,
      };

    case 'PLAY_CARD': {
      const { deckCardIndex, xValue, quantity = 1 } = action.payload;
      const deckCard = state.deckCards[deckCardIndex];
      if (!deckCard) return state;

      const undoStack = pushUndo(state);
      const cardName = deckCard.scryfallData.name;
      const histLabel = quantity > 1 ? `Played ${quantity}x ${cardName}` : `Played ${cardName}`;

      // Determine if tokens should be created immediately on play:
      // - Instants/sorceries always resolve immediately
      // - ETB permanents trigger on entering the battlefield
      // - All other permanents wait for their trigger (landfall, upkeep, tap, etc.)
      // - Modal cards (all tokens conditional) skip auto-create so the player can choose
      const allTokensConditional = deckCard.tokens.length > 0 && deckCard.tokens.every(t => t.isConditional);
      const shouldCreateTokensNow = isTokenGenerator(deckCard) && !allTokensConditional && (
        isInstantOrSorcery(deckCard) ||
        deckCard.triggerInfo?.type === 'etb' ||
        deckCard.triggerInfo?.alsoEtb ||
        !deckCard.triggerInfo // no detected trigger = one-shot effect
      );

      let newStandaloneTokens = state.standaloneTokens;
      if (shouldCreateTokensNow) {
        const supportCards = state.battlefield
          .map(bc => state.deckCards[bc.deckCardIndex])
          .filter(c => c.category === 'support' || c.category === 'both');

        // Handle self-copies countMode: auto-calculate from battlefield state
        // For simultaneous entry of N copies, each sees (alreadyInPlay + N - 1) others
        const hasSelfCopies = deckCard.tokens.some(t => t.countMode === 'self-copies');
        if (hasSelfCopies) {
          const alreadyInPlay = state.battlefield.filter(b => b.deckCardIndex === deckCardIndex).length;
          // Each copy entering sees: existing copies + other copies entering simultaneously
          const eachSees = alreadyInPlay + quantity - 1;
          // Create a modified card with the calculated count
          const modifiedCard = {
            ...deckCard,
            tokens: deckCard.tokens.map(t =>
              t.countMode === 'self-copies' ? { ...t, count: eachSees } : t
            ),
          };
          // Each entering copy triggers separately
          for (let i = 0; i < quantity; i++) {
            const results = calculateTokens(modifiedCard, supportCards, xValue ?? 1);
            const newTokens: StandaloneToken[] = results.map(calc => ({
              id: crypto.randomUUID(),
              tokenDef: calc.baseTokens,
              tokenArt: isCopyToken(calc.baseTokens) ? undefined : calc.tokenArt,
              finalCount: calc.finalCount,
              breakdown: calc.breakdown,
              sourceName: deckCard.scryfallData.name,
              copyOfDeckIndex: isCopyToken(calc.baseTokens) ? deckCardIndex : undefined,
              createdOnTurn: state.currentTurn,
            }));
            newStandaloneTokens = [...newStandaloneTokens, ...newTokens];
          }
        } else {
          const results = calculateTokens(deckCard, supportCards, xValue ?? 1);
          const newTokens: StandaloneToken[] = results.map(calc => ({
            id: crypto.randomUUID(),
            tokenDef: calc.baseTokens,
            tokenArt: isCopyToken(calc.baseTokens) ? undefined : calc.tokenArt,
            finalCount: calc.finalCount,
            breakdown: calc.breakdown,
            sourceName: deckCard.scryfallData.name,
            copyOfDeckIndex: isCopyToken(calc.baseTokens) ? deckCardIndex : undefined,
            createdOnTurn: state.currentTurn,
          }));
          newStandaloneTokens = [...state.standaloneTokens, ...newTokens];
        }
      }

      // Check if this card triggers populate on play (ETB or instant/sorcery)
      const shouldPopulateNow = deckCard.hasPopulate && (
        isInstantOrSorcery(deckCard) ||
        deckCard.triggerInfo?.type === 'etb' ||
        deckCard.triggerInfo?.alsoEtb ||
        !deckCard.triggerInfo
      );
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
      const inPlayCount = state.battlefield.filter(b => b.deckCardIndex === deckCardIndex).length;
      if (inPlayCount + quantity > deckCard.decklistEntry.quantity) {
        return { ...state, standaloneTokens: newStandaloneTokens, pendingPopulate: state.pendingPopulate + populateAdd, undoStack, history: addHistory(state, histLabel) };
      }

      const newCards: BattlefieldCard[] = [];
      for (let i = 0; i < quantity; i++) {
        newCards.push({
          instanceId: crypto.randomUUID(),
          deckCardIndex,
          xValue,
        });
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

      // Find the battlefield instance to check its conditionMet state
      const bc = state.battlefield.find(b => b.deckCardIndex === deckCardIndex);
      const conditionMet = bc?.conditionsMet ?? {};
      let activeCard = getActiveTokens(deckCard, conditionMet);

      // Handle self-copies countMode: count from battlefield state
      const hasSelfCopies = activeCard.tokens.some(t => t.countMode === 'self-copies');
      if (hasSelfCopies) {
        const inPlay = state.battlefield.filter(b => b.deckCardIndex === deckCardIndex).length;
        activeCard = {
          ...activeCard,
          tokens: activeCard.tokens.map(t =>
            t.countMode === 'self-copies' ? { ...t, count: inPlay - 1 } : t
          ),
        };
      }

      const supportCards = state.battlefield
        .map(b => state.deckCards[b.deckCardIndex])
        .filter(c => c.category === 'support' || c.category === 'both');

      const results = calculateTokens(activeCard, supportCards, xValue ?? 1);
      const newTokens: StandaloneToken[] = results.map(calc => ({
        id: crypto.randomUUID(),
        tokenDef: calc.baseTokens,
        tokenArt: isCopyToken(calc.baseTokens) ? undefined : calc.tokenArt,
        finalCount: calc.finalCount,
        breakdown: calc.breakdown,
        sourceName: deckCard.scryfallData.name,
        copyOfDeckIndex: isCopyToken(calc.baseTokens) ? deckCardIndex : undefined,
        createdOnTurn: state.currentTurn,
      }));

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

      const supportCards = state.battlefield
        .map(bc => state.deckCards[bc.deckCardIndex])
        .filter(c => c.category === 'support' || c.category === 'both');

      const allNewTokens: StandaloneToken[] = [];
      const xTriggerQueue: number[] = [];

      // Trigger battlefield permanents
      for (const bc of state.battlefield) {
        const card = state.deckCards[bc.deckCardIndex];
        if (!isTokenGenerator(card) || !card.triggerInfo || !triggerTypes.includes(card.triggerInfo.type)) continue;

        const activeCard = getActiveTokens(card, bc.conditionsMet ?? {});
        if (activeCard.tokens.some(t => t.count === -1)) {
          xTriggerQueue.push(bc.deckCardIndex);
          continue;
        }

        const results = calculateTokens(activeCard, supportCards);
        for (const calc of results) {
          allNewTokens.push({
            id: crypto.randomUUID(),
            tokenDef: calc.baseTokens,
            tokenArt: isCopyToken(calc.baseTokens) ? undefined : calc.tokenArt,
            finalCount: calc.finalCount,
            breakdown: calc.breakdown,
            sourceName: card.scryfallData.name,
            copyOfDeckIndex: isCopyToken(calc.baseTokens) ? bc.deckCardIndex : undefined,
            createdOnTurn: state.currentTurn,
          });
        }
      }

      // Also trigger copy tokens that are copies of cards with matching trigger types
      for (const token of state.standaloneTokens) {
        if (token.copyOfDeckIndex === undefined) continue;
        const originalCard = state.deckCards[token.copyOfDeckIndex];
        if (!originalCard || !originalCard.triggerInfo || !triggerTypes.includes(originalCard.triggerInfo.type)) continue;

        const bc = state.battlefield.find(b => b.deckCardIndex === token.copyOfDeckIndex);
        const conditionMet = bc?.conditionsMet ?? {};
        const activeCard = getActiveTokens(originalCard, conditionMet);
        if (activeCard.tokens.some(t => t.count === -1)) continue;

        for (let i = 0; i < token.finalCount; i++) {
          const results = calculateTokens(activeCard, supportCards);
          for (const calc of results) {
            allNewTokens.push({
              id: crypto.randomUUID(),
              tokenDef: calc.baseTokens,
              tokenArt: isCopyToken(calc.baseTokens) ? undefined : calc.tokenArt,
              finalCount: calc.finalCount,
              breakdown: calc.breakdown,
              sourceName: `Copy of ${originalCard.scryfallData.name}`,
              copyOfDeckIndex: isCopyToken(calc.baseTokens) ? token.copyOfDeckIndex : undefined,
              createdOnTurn: state.currentTurn,
            });
          }
        }
      }

      // Count populate triggers from battlefield cards
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
      return {
        ...state,
        pendingPopulate: Math.max(0, state.pendingPopulate - 1),
      };

    case 'CANCEL_POPULATE':
      return {
        ...state,
        pendingPopulate: 0,
      };

    case 'SHIFT_X_TRIGGER':
      return {
        ...state,
        pendingXTriggers: state.pendingXTriggers.slice(1),
      };

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
