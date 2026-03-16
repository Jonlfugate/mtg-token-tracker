import { describe, it, expect } from 'vitest';
import { appReducer, initialState } from '../appReducer';
import type { AppState, DeckCard } from '../../types';

function makeDeckCard(name: string, overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    decklistEntry: { quantity: 4, name },
    scryfallData: {
      id: `id-${name}`, name, oracle_text: '', mana_cost: '{1}',
      type_line: 'Creature — Human',
    },
    category: 'token-generator',
    tokens: [{
      count: 1, power: '1', toughness: '1',
      colors: ['white'], name: 'Soldier', types: ['creature'],
      keywords: [], rawText: 'a 1/1 white Soldier creature token',
    }],
    supportEffects: [],
    tokenArt: [],
    triggerInfo: { type: 'etb', label: 'ETB' },
    ...overrides,
  };
}

function stateWith(overrides: Partial<AppState>): AppState {
  return { ...initialState, importStatus: 'done', ...overrides };
}

describe('appReducer', () => {
  describe('PLAY_CARD', () => {
    it('adds card to battlefield and creates tokens for ETB', () => {
      const deckCards = [makeDeckCard('Soldier Maker')];
      const state = stateWith({ deckCards });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(next.battlefield).toHaveLength(1);
      expect(next.battlefield[0].deckCardIndex).toBe(0);
      expect(next.standaloneTokens).toHaveLength(1);
      expect(next.standaloneTokens[0].tokenDef.name).toBe('Soldier');
    });

    it('does not add to battlefield for instants/sorceries', () => {
      const card = makeDeckCard('Bolt', {
        scryfallData: {
          id: 'bolt', name: 'Bolt', oracle_text: '', mana_cost: '{R}',
          type_line: 'Instant',
        },
      });
      const state = stateWith({ deckCards: [card] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(next.battlefield).toHaveLength(0);
      expect(next.standaloneTokens).toHaveLength(1);
    });

    it('pushes undo state', () => {
      const state = stateWith({ deckCards: [makeDeckCard('Test')] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(next.undoStack).toHaveLength(1);
    });

    it('adds history entry', () => {
      const state = stateWith({ deckCards: [makeDeckCard('Test Card')] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(next.history).toHaveLength(1);
      expect(next.history[0].label).toContain('Test Card');
    });

    it('does not create tokens for non-ETB triggers', () => {
      const card = makeDeckCard('Landfall Card', {
        triggerInfo: { type: 'landfall', label: 'Landfall' },
      });
      const state = stateWith({ deckCards: [card] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(next.battlefield).toHaveLength(1);
      expect(next.standaloneTokens).toHaveLength(0);
    });

    it('handles self-copies countMode', () => {
      const card = makeDeckCard('Hare Apparent', {
        tokens: [{
          count: 0, power: '1', toughness: '1',
          colors: ['white'], name: 'Rabbit', types: ['creature'],
          keywords: [], rawText: 'token', countMode: 'self-copies',
        }],
      });
      const state = stateWith({
        deckCards: [card],
        battlefield: [
          { instanceId: 'existing-1', deckCardIndex: 0 },
          { instanceId: 'existing-2', deckCardIndex: 0 },
        ],
      });
      // Playing a 3rd copy: it sees 2 already in play + 0 others entering = 2
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(next.standaloneTokens).toHaveLength(1);
      expect(next.standaloneTokens[0].finalCount).toBe(2);
    });
  });

  describe('TRIGGER_CARD', () => {
    it('creates tokens from battlefield card', () => {
      const card = makeDeckCard('Generator');
      const state = stateWith({
        deckCards: [card],
        battlefield: [{ instanceId: 'inst-1', deckCardIndex: 0 }],
      });
      const next = appReducer(state, { type: 'TRIGGER_CARD', payload: { deckCardIndex: 0 } });
      expect(next.standaloneTokens).toHaveLength(1);
    });

    it('applies self-copies count from battlefield', () => {
      const card = makeDeckCard('Hare Apparent', {
        tokens: [{
          count: 0, power: '1', toughness: '1',
          colors: ['white'], name: 'Rabbit', types: ['creature'],
          keywords: [], rawText: 'token', countMode: 'self-copies',
        }],
      });
      const state = stateWith({
        deckCards: [card],
        battlefield: [
          { instanceId: 'inst-1', deckCardIndex: 0 },
          { instanceId: 'inst-2', deckCardIndex: 0 },
          { instanceId: 'inst-3', deckCardIndex: 0 },
        ],
      });
      // 3 in play, each sees 2 others
      const next = appReducer(state, { type: 'TRIGGER_CARD', payload: { deckCardIndex: 0 } });
      expect(next.standaloneTokens[0].finalCount).toBe(2);
    });
  });

  describe('UNDO', () => {
    it('restores previous state', () => {
      const card = makeDeckCard('Test');
      const state = stateWith({ deckCards: [card] });
      const afterPlay = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(afterPlay.battlefield).toHaveLength(1);

      const afterUndo = appReducer(afterPlay, { type: 'UNDO' });
      expect(afterUndo.battlefield).toHaveLength(0);
      expect(afterUndo.standaloneTokens).toHaveLength(0);
    });

    it('does nothing with empty undo stack', () => {
      const state = stateWith({});
      const next = appReducer(state, { type: 'UNDO' });
      expect(next).toBe(state);
    });
  });

  describe('REMOVE_CARD', () => {
    it('removes card from battlefield', () => {
      const state = stateWith({
        deckCards: [makeDeckCard('Test')],
        battlefield: [{ instanceId: 'inst-1', deckCardIndex: 0 }],
      });
      const next = appReducer(state, { type: 'REMOVE_CARD', payload: { instanceId: 'inst-1' } });
      expect(next.battlefield).toHaveLength(0);
    });
  });

  describe('CLEAR_ALL_TOKENS', () => {
    it('removes all standalone tokens', () => {
      const state = stateWith({
        deckCards: [makeDeckCard('Test')],
        standaloneTokens: [{
          id: 'tok-1',
          tokenDef: { count: 1, power: '1', toughness: '1', colors: [], name: 'Soldier', types: ['creature'], keywords: [], rawText: '' },
          finalCount: 3, breakdown: '3', sourceName: 'Test', createdOnTurn: 1,
        }],
      });
      const next = appReducer(state, { type: 'CLEAR_ALL_TOKENS' });
      expect(next.standaloneTokens).toHaveLength(0);
    });

    it('does nothing when no tokens exist', () => {
      const state = stateWith({});
      const next = appReducer(state, { type: 'CLEAR_ALL_TOKENS' });
      expect(next).toBe(state);
    });
  });

  describe('ADJUST_TOKEN', () => {
    it('increases token count', () => {
      const state = stateWith({
        standaloneTokens: [{
          id: 'tok-1',
          tokenDef: { count: 1, power: '1', toughness: '1', colors: [], name: 'Soldier', types: ['creature'], keywords: [], rawText: '' },
          finalCount: 3, breakdown: '3', sourceName: 'Test', createdOnTurn: 1,
        }],
      });
      const next = appReducer(state, { type: 'ADJUST_TOKEN', payload: { id: 'tok-1', delta: 1 } });
      expect(next.standaloneTokens[0].finalCount).toBe(4);
    });

    it('removes token when count reaches 0', () => {
      const state = stateWith({
        standaloneTokens: [{
          id: 'tok-1',
          tokenDef: { count: 1, power: '1', toughness: '1', colors: [], name: 'Soldier', types: ['creature'], keywords: [], rawText: '' },
          finalCount: 1, breakdown: '1', sourceName: 'Test', createdOnTurn: 1,
        }],
      });
      const next = appReducer(state, { type: 'ADJUST_TOKEN', payload: { id: 'tok-1', delta: -1 } });
      expect(next.standaloneTokens).toHaveLength(0);
    });
  });

  describe('REMOVE_ALL_INSTANCES', () => {
    it('removes all battlefield cards with the given deckCardIndex', () => {
      const state = stateWith({
        deckCards: [makeDeckCard('Rhys'), makeDeckCard('Other')],
        battlefield: [
          { instanceId: 'inst-1', deckCardIndex: 0 },
          { instanceId: 'inst-2', deckCardIndex: 0 },
          { instanceId: 'inst-3', deckCardIndex: 1 },
        ],
      });
      const next = appReducer(state, { type: 'REMOVE_ALL_INSTANCES', payload: { deckCardIndex: 0 } });
      expect(next.battlefield).toHaveLength(1);
      expect(next.battlefield[0].instanceId).toBe('inst-3');
    });

    it('pushes undo state', () => {
      const state = stateWith({
        deckCards: [makeDeckCard('Rhys')],
        battlefield: [{ instanceId: 'inst-1', deckCardIndex: 0 }],
      });
      const next = appReducer(state, { type: 'REMOVE_ALL_INSTANCES', payload: { deckCardIndex: 0 } });
      expect(next.undoStack).toHaveLength(1);
    });

    it('adds history entry with card name', () => {
      const state = stateWith({
        deckCards: [makeDeckCard('Rhys')],
        battlefield: [{ instanceId: 'inst-1', deckCardIndex: 0 }],
      });
      const next = appReducer(state, { type: 'REMOVE_ALL_INSTANCES', payload: { deckCardIndex: 0 } });
      expect(next.history[0].label).toContain('Rhys');
    });

    it('does not remove cards with a different deckCardIndex', () => {
      const state = stateWith({
        deckCards: [makeDeckCard('Card A'), makeDeckCard('Card B')],
        battlefield: [
          { instanceId: 'inst-a', deckCardIndex: 0 },
          { instanceId: 'inst-b', deckCardIndex: 1 },
        ],
      });
      const next = appReducer(state, { type: 'REMOVE_ALL_INSTANCES', payload: { deckCardIndex: 1 } });
      expect(next.battlefield).toHaveLength(1);
      expect(next.battlefield[0].deckCardIndex).toBe(0);
    });
  });

  describe('NEW_TURN', () => {
    it('increments currentTurn', () => {
      const state = stateWith({ currentTurn: 3 });
      const next = appReducer(state, { type: 'NEW_TURN' });
      expect(next.currentTurn).toBe(4);
    });

    it('adds history entry', () => {
      const state = stateWith({ currentTurn: 1 });
      const next = appReducer(state, { type: 'NEW_TURN' });
      expect(next.history[0].label).toContain('Turn 2');
    });

    it('clears board-state conditions on new turn', () => {
      const card = makeDeckCard('Deathreap Ritual', {
        tokens: [{
          count: 1, power: '1', toughness: '1',
          colors: ['black'], name: 'Zombie', types: ['creature'],
          keywords: [], rawText: '',
          isConditional: true,
          conditionType: 'board-state',
          conditionKey: 'morbid',
        }],
      });
      const state = stateWith({
        deckCards: [card],
        battlefield: [{
          instanceId: 'inst-1',
          deckCardIndex: 0,
          conditionsMet: { morbid: true },
        }],
      });
      const next = appReducer(state, { type: 'NEW_TURN' });
      expect(next.battlefield[0].conditionsMet?.morbid).toBe(false);
    });

    it('does not clear non-board-state conditions on new turn', () => {
      const card = makeDeckCard('Modal Card', {
        tokens: [{
          count: 1, power: '1', toughness: '1',
          colors: ['white'], name: 'Angel', types: ['creature'],
          keywords: [], rawText: '',
          isConditional: true,
          conditionType: 'modal',
          conditionKey: 'angel-mode',
        }],
      });
      const state = stateWith({
        deckCards: [card],
        battlefield: [{
          instanceId: 'inst-1',
          deckCardIndex: 0,
          conditionsMet: { 'angel-mode': true },
        }],
      });
      const next = appReducer(state, { type: 'NEW_TURN' });
      expect(next.battlefield[0].conditionsMet?.['angel-mode']).toBe(true);
    });

    it('does not push undo state', () => {
      const state = stateWith({ currentTurn: 1 });
      const next = appReducer(state, { type: 'NEW_TURN' });
      expect(next.undoStack).toHaveLength(0);
    });
  });

  describe('ADD_CARD', () => {
    it('adds a new card to deckCards', () => {
      const state = stateWith({ deckCards: [makeDeckCard('Existing')] });
      const newCard = makeDeckCard('New Card');
      const next = appReducer(state, { type: 'ADD_CARD', payload: newCard });
      expect(next.deckCards).toHaveLength(2);
      expect(next.deckCards[1].scryfallData.name).toBe('New Card');
    });

    it('does not add a duplicate card by name', () => {
      const existing = makeDeckCard('Rhys the Redeemed');
      const state = stateWith({ deckCards: [existing] });
      const duplicate = makeDeckCard('Rhys the Redeemed');
      const next = appReducer(state, { type: 'ADD_CARD', payload: duplicate });
      expect(next.deckCards).toHaveLength(1);
      expect(next).toBe(state);
    });

    it('returns same state reference when card is duplicate', () => {
      const card = makeDeckCard('Chatterfang');
      const state = stateWith({ deckCards: [card] });
      const next = appReducer(state, { type: 'ADD_CARD', payload: card });
      expect(next).toBe(state);
    });
  });

  describe('CLEAR_TURN_TOKENS', () => {
    it('removes only tokens created on the current turn', () => {
      const state = stateWith({
        currentTurn: 3,
        standaloneTokens: [
          { id: 'old-tok', tokenDef: { count: 1, power: '1', toughness: '1', colors: [], name: 'Soldier', types: ['creature'], keywords: [], rawText: '' }, finalCount: 2, breakdown: '2', sourceName: 'A', createdOnTurn: 1 },
          { id: 'cur-tok', tokenDef: { count: 1, power: '1', toughness: '1', colors: [], name: 'Zombie', types: ['creature'], keywords: [], rawText: '' }, finalCount: 3, breakdown: '3', sourceName: 'B', createdOnTurn: 3 },
        ],
      });
      const next = appReducer(state, { type: 'CLEAR_TURN_TOKENS' });
      expect(next.standaloneTokens).toHaveLength(1);
      expect(next.standaloneTokens[0].id).toBe('old-tok');
    });

    it('does nothing when no tokens exist for current turn', () => {
      const state = stateWith({
        currentTurn: 5,
        standaloneTokens: [
          { id: 'tok-1', tokenDef: { count: 1, power: '1', toughness: '1', colors: [], name: 'Soldier', types: ['creature'], keywords: [], rawText: '' }, finalCount: 1, breakdown: '1', sourceName: 'A', createdOnTurn: 2 },
        ],
      });
      const next = appReducer(state, { type: 'CLEAR_TURN_TOKENS' });
      expect(next).toBe(state);
    });

    it('pushes undo state when tokens are cleared', () => {
      const state = stateWith({
        currentTurn: 1,
        standaloneTokens: [
          { id: 'tok-1', tokenDef: { count: 1, power: '1', toughness: '1', colors: [], name: 'Soldier', types: ['creature'], keywords: [], rawText: '' }, finalCount: 1, breakdown: '1', sourceName: 'A', createdOnTurn: 1 },
        ],
      });
      const next = appReducer(state, { type: 'CLEAR_TURN_TOKENS' });
      expect(next.undoStack).toHaveLength(1);
    });
  });

  describe('TRIGGER_ALL', () => {
    it('does not trigger end-step cards when triggerTypes is upkeep+combat', () => {
      const card = makeDeckCard('End Step Card', {
        triggerInfo: { type: 'end-step', label: 'End Step' },
      });
      const state = stateWith({
        deckCards: [card],
        battlefield: [{ instanceId: 'inst-1', deckCardIndex: 0 }],
      });
      const next = appReducer(state, {
        type: 'TRIGGER_ALL',
        payload: { triggerTypes: ['upkeep', 'combat'] },
      });
      expect(next.standaloneTokens).toHaveLength(0);
    });

    it('triggers upkeep cards with upkeep trigger', () => {
      const card = makeDeckCard('Upkeep Card', {
        triggerInfo: { type: 'upkeep', label: 'Upkeep' },
      });
      const state = stateWith({
        deckCards: [card],
        battlefield: [{ instanceId: 'inst-1', deckCardIndex: 0 }],
      });
      const next = appReducer(state, {
        type: 'TRIGGER_ALL',
        payload: { triggerTypes: ['upkeep'] },
      });
      expect(next.standaloneTokens).toHaveLength(1);
    });

    it('triggers end-step cards when end-step is included', () => {
      const card = makeDeckCard('End Step Card', {
        triggerInfo: { type: 'end-step', label: 'End Step' },
      });
      const state = stateWith({
        deckCards: [card],
        battlefield: [{ instanceId: 'inst-1', deckCardIndex: 0 }],
      });
      const next = appReducer(state, {
        type: 'TRIGGER_ALL',
        payload: { triggerTypes: ['upkeep', 'combat', 'end-step'] },
      });
      expect(next.standaloneTokens).toHaveLength(1);
    });
  });

  describe('copy-turn-tokens (TRIGGER_CARD)', () => {
    it('creates copies of all tokens created this turn when copy-turn-tokens fires', () => {
      const card = makeDeckCard('Ocelot Pride', {
        tokens: [{
          count: 0, power: '1', toughness: '1',
          colors: ['white'], name: 'Cat', types: ['creature'],
          keywords: [], rawText: '',
          countMode: 'copy-turn-tokens',
        }],
        triggerInfo: { type: 'end-step', label: 'End Step' },
      });
      const state = stateWith({
        currentTurn: 1,
        deckCards: [card],
        battlefield: [{ instanceId: 'inst-1', deckCardIndex: 0 }],
        standaloneTokens: [
          { id: 'tok-1', tokenDef: { count: 1, power: '1', toughness: '1', colors: ['white'], name: 'Soldier', types: ['creature'], keywords: [], rawText: '' }, finalCount: 3, breakdown: '3', sourceName: 'Other', createdOnTurn: 1 },
        ],
      });
      const next = appReducer(state, { type: 'TRIGGER_CARD', payload: { deckCardIndex: 0 } });
      // Should have original Soldier + copies of Soldier
      const copyTokens = next.standaloneTokens.filter(t => t.breakdown.includes("city's blessing"));
      expect(copyTokens).toHaveLength(1);
      expect(copyTokens[0].finalCount).toBe(3);
    });

    it('does not copy tokens from previous turns', () => {
      const card = makeDeckCard('Ocelot Pride', {
        tokens: [{
          count: 0, power: '1', toughness: '1',
          colors: ['white'], name: 'Cat', types: ['creature'],
          keywords: [], rawText: '',
          countMode: 'copy-turn-tokens',
        }],
        triggerInfo: { type: 'end-step', label: 'End Step' },
      });
      const state = stateWith({
        currentTurn: 2,
        deckCards: [card],
        battlefield: [{ instanceId: 'inst-1', deckCardIndex: 0 }],
        standaloneTokens: [
          { id: 'old-tok', tokenDef: { count: 1, power: '1', toughness: '1', colors: ['white'], name: 'Soldier', types: ['creature'], keywords: [], rawText: '' }, finalCount: 2, breakdown: '2', sourceName: 'Old', createdOnTurn: 1 },
        ],
      });
      const next = appReducer(state, { type: 'TRIGGER_CARD', payload: { deckCardIndex: 0 } });
      const copyTokens = next.standaloneTokens.filter(t => t.breakdown.includes("city's blessing"));
      expect(copyTokens).toHaveLength(0);
    });
  });
});
