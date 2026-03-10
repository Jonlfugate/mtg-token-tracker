import type { AppState, BattlefieldCard, DeckCard, StandaloneToken } from '../types';
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

// Filter tokens based on whether the condition is met:
// - If conditionMet: use conditional tokens (and skip the default ones they replace)
// - If not: use only non-conditional tokens
function getActiveTokens(card: DeckCard, conditionMet: boolean): DeckCard {
  if (!hasCondition(card)) return card;

  const filteredTokens = conditionMet
    ? card.tokens.filter(t => t.isConditional)
    : card.tokens.filter(t => !t.isConditional);

  return { ...card, tokens: filteredTokens };
}

function isCopyToken(tokenDef: { name: string }): boolean {
  return tokenDef.name.toLowerCase().startsWith('copy of ');
}

export type AppAction =
  | { type: 'SET_RAW_DECKLIST'; payload: string }
  | { type: 'IMPORT_START'; payload: { total: number } }
  | { type: 'FETCH_PROGRESS'; payload: { done: number; total: number } }
  | { type: 'IMPORT_COMPLETE'; payload: DeckCard[] }
  | { type: 'IMPORT_ERROR'; payload: string }
  | { type: 'PLAY_CARD'; payload: { deckCardIndex: number; xValue?: number } }
  | { type: 'REMOVE_CARD'; payload: { instanceId: string } }
  | { type: 'TRIGGER_CARD'; payload: { deckCardIndex: number; xValue?: number } }
  | { type: 'TRIGGER_ALL'; payload: { triggerTypes: string[] } }
  | { type: 'TOGGLE_CONDITION'; payload: { instanceId: string } }
  | { type: 'REMOVE_STANDALONE_TOKEN'; payload: { id: string } }
  | { type: 'ADJUST_TOKEN'; payload: { id: string; delta: number } }
  | { type: 'RESOLVE_POPULATE' }
  | { type: 'CANCEL_POPULATE' }
  | { type: 'SHIFT_X_TRIGGER' }
  | { type: 'NEW_TURN' }
  | { type: 'RESET' }
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
      const { deckCardIndex, xValue } = action.payload;
      const deckCard = state.deckCards[deckCardIndex];
      if (!deckCard) return state;

      // Determine if tokens should be created immediately on play:
      // - Instants/sorceries always resolve immediately
      // - ETB permanents trigger on entering the battlefield
      // - All other permanents wait for their trigger (landfall, upkeep, tap, etc.)
      const shouldCreateTokensNow = isTokenGenerator(deckCard) && (
        isInstantOrSorcery(deckCard) ||
        deckCard.triggerInfo?.type === 'etb' ||
        !deckCard.triggerInfo // no detected trigger = one-shot effect
      );

      let newStandaloneTokens = state.standaloneTokens;
      if (shouldCreateTokensNow) {
        const supportCards = state.battlefield
          .map(bc => state.deckCards[bc.deckCardIndex])
          .filter(c => c.category === 'support' || c.category === 'both');

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

      // Check if this card triggers populate on play (ETB or instant/sorcery)
      const shouldPopulateNow = deckCard.hasPopulate && (
        isInstantOrSorcery(deckCard) ||
        deckCard.triggerInfo?.type === 'etb' ||
        !deckCard.triggerInfo
      );
      const populateAdd = shouldPopulateNow ? 1 : 0;

      // Instants/sorceries don't stay on the battlefield
      if (isInstantOrSorcery(deckCard)) {
        return {
          ...state,
          standaloneTokens: newStandaloneTokens,
          pendingPopulate: state.pendingPopulate + populateAdd,
        };
      }

      // Permanents go to the battlefield
      const inPlayCount = state.battlefield.filter(b => b.deckCardIndex === deckCardIndex).length;
      if (inPlayCount >= deckCard.decklistEntry.quantity) {
        return { ...state, standaloneTokens: newStandaloneTokens, pendingPopulate: state.pendingPopulate + populateAdd };
      }

      const newCard: BattlefieldCard = {
        instanceId: crypto.randomUUID(),
        deckCardIndex,
        xValue,
      };

      return {
        ...state,
        battlefield: [...state.battlefield, newCard],
        standaloneTokens: newStandaloneTokens,
        pendingPopulate: state.pendingPopulate + populateAdd,
      };
    }

    case 'TRIGGER_CARD': {
      const { deckCardIndex, xValue } = action.payload;
      const deckCard = state.deckCards[deckCardIndex];
      if (!deckCard || !isTokenGenerator(deckCard)) return state;

      // Find the battlefield instance to check its conditionMet state
      const bc = state.battlefield.find(b => b.deckCardIndex === deckCardIndex);
      const conditionMet = bc?.conditionMet ?? false;
      const activeCard = getActiveTokens(deckCard, conditionMet);

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
      };
    }

    case 'TRIGGER_ALL': {
      const { triggerTypes } = action.payload;

      const supportCards = state.battlefield
        .map(bc => state.deckCards[bc.deckCardIndex])
        .filter(c => c.category === 'support' || c.category === 'both');

      const allNewTokens: StandaloneToken[] = [];
      const xTriggerQueue: number[] = [];

      // Trigger battlefield permanents
      for (const bc of state.battlefield) {
        const card = state.deckCards[bc.deckCardIndex];
        if (!isTokenGenerator(card) || !card.triggerInfo || !triggerTypes.includes(card.triggerInfo.type)) continue;

        const activeCard = getActiveTokens(card, bc.conditionMet ?? false);
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
      // (e.g., Copy of Scute Swarm tokens also trigger on landfall)
      for (const token of state.standaloneTokens) {
        if (token.copyOfDeckIndex === undefined) continue;
        const originalCard = state.deckCards[token.copyOfDeckIndex];
        if (!originalCard || !originalCard.triggerInfo || !triggerTypes.includes(originalCard.triggerInfo.type)) continue;

        // Each copy token triggers once per event, creating tokens as the original would
        // Use the original card's condition state from the battlefield
        const bc = state.battlefield.find(b => b.deckCardIndex === token.copyOfDeckIndex);
        const conditionMet = bc?.conditionMet ?? false;
        const activeCard = getActiveTokens(originalCard, conditionMet);
        if (activeCard.tokens.some(t => t.count === -1)) continue;

        // Each copy triggers for each token in the group
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

      return {
        ...state,
        standaloneTokens: [...state.standaloneTokens, ...allNewTokens],
        pendingPopulate: state.pendingPopulate + populateCount,
        pendingXTriggers: [...state.pendingXTriggers, ...xTriggerQueue],
      };
    }

    case 'TOGGLE_CONDITION': {
      const { instanceId } = action.payload;
      return {
        ...state,
        battlefield: state.battlefield.map(bc =>
          bc.instanceId === instanceId
            ? { ...bc, conditionMet: !bc.conditionMet }
            : bc
        ),
      };
    }

    case 'REMOVE_CARD':
      return {
        ...state,
        battlefield: state.battlefield.filter(b => b.instanceId !== action.payload.instanceId),
      };

    case 'REMOVE_STANDALONE_TOKEN':
      return {
        ...state,
        standaloneTokens: state.standaloneTokens.filter(t => t.id !== action.payload.id),
      };

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

    case 'NEW_TURN':
      return {
        ...state,
        currentTurn: state.currentTurn + 1,
      };

    case 'RESET':
      return initialState;

    case 'LOAD_STATE':
      return action.payload;

    default:
      return state;
  }
}
