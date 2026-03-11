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
});
