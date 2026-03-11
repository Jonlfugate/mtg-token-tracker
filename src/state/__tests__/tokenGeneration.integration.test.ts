/**
 * Integration tests for the token generation pipeline.
 *
 * These tests exercise the full flow through appReducer, covering:
 * - Hare Apparent (self-copies ETB)
 * - Chatterfang (companion squirrel creation)
 * - Academy Manufactor (Clue/Food/Treasure replacement)
 * - Interactions between the above
 * - Multiple support cards stacking
 * - Edge cases (zero tokens, multipliers, etc.)
 *
 * Card data uses real Scryfall oracle text where possible.
 */
import { describe, it, expect } from 'vitest';
import { appReducer, initialState } from '../appReducer';
import type { AppState, DeckCard, BattlefieldCard, StandaloneToken } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 0;
function uid(): string { return `test-${++nextId}`; }

function makeDeckCard(name: string, overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    decklistEntry: { quantity: 4, name },
    scryfallData: {
      id: uid(), name, oracle_text: '', mana_cost: '{1}',
      type_line: 'Creature — Human',
    },
    category: 'token-generator',
    tokens: [{
      count: 1, power: '1', toughness: '1',
      colors: ['white'], name: 'Soldier', types: ['creature'],
      keywords: [], rawText: 'a 1/1 white Soldier creature token',
    }],
    tokenArt: [],
    triggerInfo: { type: 'etb', label: 'ETB' },
    ...overrides,
  };
}

/**
 * Hare Apparent — real Scryfall oracle text:
 * "When this creature enters, create a number of 1/1 white Rabbit creature tokens
 *  equal to the number of other creatures you control named Hare Apparent.
 *  A deck can have any number of cards named Hare Apparent."
 */
function makeHareApparent(): DeckCard {
  return makeDeckCard('Hare Apparent', {
    scryfallData: {
      id: uid(), name: 'Hare Apparent',
      oracle_text: 'When this creature enters, create a number of 1/1 white Rabbit creature tokens equal to the number of other creatures you control named Hare Apparent.\nA deck can have any number of cards named Hare Apparent.',
      mana_cost: '{1}{W}', type_line: 'Creature — Rabbit Noble',
      power: '2', toughness: '2',
    },
    tokens: [{
      count: 0, power: '1', toughness: '1',
      colors: ['white'], name: 'Rabbit', types: ['creature'],
      keywords: [], rawText: 'a 1/1 white Rabbit creature token',
      countMode: 'self-copies',
    }],
    triggerInfo: { type: 'etb', label: 'ETB' },
  });
}

/**
 * Chatterfang, Squirrel General — real Scryfall oracle text:
 * "Forestwalk
 *  If one or more tokens would be created under your control, those tokens plus
 *  that many 1/1 green Squirrel creature tokens are created instead.
 *  {B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn."
 */
function makeChatterfang(): DeckCard {
  return makeDeckCard('Chatterfang, Squirrel General', {
    scryfallData: {
      id: uid(), name: 'Chatterfang, Squirrel General',
      oracle_text: 'Forestwalk (This creature can\'t be blocked as long as defending player controls a Forest.)\nIf one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.\n{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.',
      mana_cost: '{2}{G}', type_line: 'Legendary Creature — Squirrel Warrior',
      power: '3', toughness: '3',
    },
    category: 'both',
    tokens: [{
      count: 1, power: '1', toughness: '1',
      colors: ['green'], name: 'Squirrel', types: ['creature'],
      keywords: [], rawText: '1/1 green Squirrel creature token',
    }],
    supportEffect: {
      type: 'companion', factor: 1,
      rawText: 'those tokens plus that many',
    },
    triggerInfo: undefined,
  });
}

/**
 * Academy Manufactor — real Scryfall oracle text:
 * "If you would create a Clue, Food, or Treasure token, instead create one of each."
 */
function makeAcademyManufactor(): DeckCard {
  return makeDeckCard('Academy Manufactor', {
    scryfallData: {
      id: uid(), name: 'Academy Manufactor',
      oracle_text: 'If you would create a Clue, Food, or Treasure token, instead create one of each.',
      mana_cost: '{3}', type_line: 'Artifact Creature — Assembly-Worker',
      power: '1', toughness: '3',
    },
    category: 'support',
    tokens: [],
    supportEffect: {
      type: 'companion', factor: 1,
      rawText: 'instead create one of each',
    },
    triggerInfo: undefined,
  });
}

/** A card that makes a Treasure token on ETB */
function makeTreasureGenerator(name = 'Treasure Maker'): DeckCard {
  return makeDeckCard(name, {
    scryfallData: {
      id: uid(), name,
      oracle_text: `When ${name} enters, create a Treasure token.`,
      mana_cost: '{2}', type_line: 'Creature — Human',
    },
    tokens: [{
      count: 1, power: '', toughness: '',
      colors: [], name: 'Treasure', types: ['artifact'],
      keywords: [], rawText: 'a Treasure token',
    }],
    triggerInfo: { type: 'etb', label: 'ETB' },
  });
}

/** A card that makes a Food token on ETB */
function makeFoodGenerator(name = 'Food Maker'): DeckCard {
  return makeDeckCard(name, {
    scryfallData: {
      id: uid(), name,
      oracle_text: `When ${name} enters, create a Food token.`,
      mana_cost: '{2}', type_line: 'Creature — Human',
    },
    tokens: [{
      count: 1, power: '', toughness: '',
      colors: [], name: 'Food', types: ['artifact'],
      keywords: [], rawText: 'a Food token',
    }],
    triggerInfo: { type: 'etb', label: 'ETB' },
  });
}

/** A card that makes a Clue token on ETB */
function makeClueGenerator(name = 'Clue Maker'): DeckCard {
  return makeDeckCard(name, {
    scryfallData: {
      id: uid(), name,
      oracle_text: `When ${name} enters, create a Clue token.`,
      mana_cost: '{2}', type_line: 'Creature — Human',
    },
    tokens: [{
      count: 1, power: '', toughness: '',
      colors: [], name: 'Clue', types: ['artifact'],
      keywords: [], rawText: 'a Clue token',
    }],
    triggerInfo: { type: 'etb', label: 'ETB' },
  });
}

/** A card that creates multiple tokens at once (e.g., 3 Soldiers) */
function makeMultiTokenGenerator(count: number, tokenName = 'Soldier'): DeckCard {
  return makeDeckCard('Multi Token Maker', {
    scryfallData: {
      id: uid(), name: 'Multi Token Maker',
      oracle_text: `When Multi Token Maker enters, create ${count} 1/1 white ${tokenName} creature tokens.`,
      mana_cost: '{4}', type_line: 'Creature — Human',
    },
    tokens: [{
      count, power: '1', toughness: '1',
      colors: ['white'], name: tokenName, types: ['creature'],
      keywords: [], rawText: `${count} 1/1 white ${tokenName} creature tokens`,
    }],
    triggerInfo: { type: 'etb', label: 'ETB' },
  });
}

/** A card that creates multiple different token types at once */
function makeMultiTypeGenerator(): DeckCard {
  return makeDeckCard('Multi Type Maker', {
    scryfallData: {
      id: uid(), name: 'Multi Type Maker',
      oracle_text: 'When Multi Type Maker enters, create a 1/1 white Soldier creature token and a Treasure token.',
      mana_cost: '{4}', type_line: 'Creature — Human',
    },
    tokens: [
      {
        count: 1, power: '1', toughness: '1',
        colors: ['white'], name: 'Soldier', types: ['creature'],
        keywords: [], rawText: 'a 1/1 white Soldier creature token',
      },
      {
        count: 1, power: '', toughness: '',
        colors: [], name: 'Treasure', types: ['artifact'],
        keywords: [], rawText: 'a Treasure token',
      },
    ],
    triggerInfo: { type: 'etb', label: 'ETB' },
  });
}

/**
 * Anointed Procession — real Scryfall oracle text:
 * "If an effect would create one or more tokens under your control,
 *  it creates twice that many of those tokens instead."
 */
function makeDoubler(name = 'Anointed Procession'): DeckCard {
  return makeDeckCard(name, {
    scryfallData: {
      id: uid(), name,
      oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
      mana_cost: '{3}{W}', type_line: 'Enchantment',
    },
    category: 'support',
    tokens: [],
    supportEffect: {
      type: 'multiplier', factor: 2,
      rawText: 'twice that many of those tokens',
    },
    triggerInfo: undefined,
  });
}

/** A card that adds +1 token */
function makeAdder(name = 'Token Adder'): DeckCard {
  return makeDeckCard(name, {
    scryfallData: {
      id: uid(), name,
      oracle_text: 'If you would create a token, create an additional token.',
      mana_cost: '{3}', type_line: 'Enchantment',
    },
    category: 'support',
    tokens: [],
    supportEffect: {
      type: 'additional', factor: 1,
      rawText: 'an additional token',
    },
    triggerInfo: undefined,
  });
}

/** A creature-only doubler */
function makeCreatureDoubler(name = 'Creature Doubler'): DeckCard {
  return makeDeckCard(name, {
    scryfallData: {
      id: uid(), name,
      oracle_text: 'If an effect would create one or more creature tokens, it creates twice that many of those creature tokens instead.',
      mana_cost: '{3}{G}', type_line: 'Enchantment',
    },
    category: 'support',
    tokens: [],
    supportEffect: {
      type: 'multiplier', factor: 2, condition: 'creature tokens',
      rawText: 'twice that many of those creature tokens',
    },
    triggerInfo: undefined,
  });
}

/** A landfall token generator */
function makeLandfallGenerator(): DeckCard {
  return makeDeckCard('Landfall Generator', {
    scryfallData: {
      id: uid(), name: 'Landfall Generator',
      oracle_text: 'Landfall — Whenever a land you control enters, create a 1/1 green Plant creature token.',
      mana_cost: '{2}{G}', type_line: 'Creature — Elemental',
    },
    tokens: [{
      count: 1, power: '1', toughness: '1',
      colors: ['green'], name: 'Plant', types: ['creature'],
      keywords: [], rawText: 'a 1/1 green Plant creature token',
    }],
    triggerInfo: { type: 'landfall', label: 'Landfall' },
  });
}

function stateWith(overrides: Partial<AppState>): AppState {
  return { ...initialState, importStatus: 'done', ...overrides };
}

function bf(deckCardIndex: number, extra: Partial<BattlefieldCard> = {}): BattlefieldCard {
  return { instanceId: uid(), deckCardIndex, ...extra };
}

function getTokensByName(tokens: StandaloneToken[], name: string): StandaloneToken[] {
  return tokens.filter(t => t.tokenDef.name.toLowerCase() === name.toLowerCase());
}

function totalTokenCount(tokens: StandaloneToken[], name?: string): number {
  const filtered = name ? getTokensByName(tokens, name) : tokens;
  return filtered.reduce((sum, t) => sum + t.finalCount, 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Token Generation Integration Tests', () => {

  // =========================================================================
  // HARE APPARENT
  // =========================================================================
  describe('Hare Apparent (self-copies ETB)', () => {
    it('does NOT create a token entry when playing the first copy (no others in play)', () => {
      const hare = makeHareApparent();
      const state = stateWith({ deckCards: [hare] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // First Hare: 0 other Hares → 0 Rabbits → no StandaloneToken should exist
      expect(next.standaloneTokens).toHaveLength(0);
      expect(totalTokenCount(next.standaloneTokens, 'Rabbit')).toBe(0);
      // Card still goes to battlefield
      expect(next.battlefield).toHaveLength(1);
    });

    it('creates 1 Rabbit when playing second copy (1 already in play)', () => {
      const hare = makeHareApparent();
      const state = stateWith({
        deckCards: [hare],
        battlefield: [bf(0)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Rabbit')).toBe(1);
    });

    it('creates 2 Rabbits when playing third copy (2 already in play)', () => {
      const hare = makeHareApparent();
      const state = stateWith({
        deckCards: [hare],
        battlefield: [bf(0), bf(0)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Rabbit')).toBe(2);
    });

    it('creates 3 Rabbits when playing fourth copy (3 already in play)', () => {
      const hare = makeHareApparent();
      const state = stateWith({
        deckCards: [hare],
        battlefield: [bf(0), bf(0), bf(0)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Rabbit')).toBe(3);
    });

    it('playing 2 copies at once via quantity: each sees the same count', () => {
      const hare = makeHareApparent();
      const state = stateWith({
        deckCards: [hare],
        battlefield: [bf(0)], // 1 already in play
      });
      // Play 2 more: alreadyInPlay=1, quantity=2, eachSees = 1+2-1 = 2
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0, quantity: 2 } });

      // Each of the 2 copies creates 2 rabbits = 4 total
      expect(totalTokenCount(next.standaloneTokens, 'Rabbit')).toBe(4);
    });

    it('TRIGGER_CARD uses battlefield count for self-copies', () => {
      const hare = makeHareApparent();
      const state = stateWith({
        deckCards: [hare],
        battlefield: [bf(0), bf(0), bf(0)], // 3 in play
      });
      const next = appReducer(state, { type: 'TRIGGER_CARD', payload: { deckCardIndex: 0 } });

      // resolveActiveCard: inPlay=3, count = max(0, 3-1) = 2
      expect(totalTokenCount(next.standaloneTokens, 'Rabbit')).toBe(2);
    });

    it('Rabbit token has correct power/toughness (not 0)', () => {
      const hare = makeHareApparent();
      const state = stateWith({
        deckCards: [hare],
        battlefield: [bf(0)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      const rabbit = next.standaloneTokens[0];
      expect(rabbit).toBeDefined();
      expect(rabbit.tokenDef.power).toBe('1');
      expect(rabbit.tokenDef.toughness).toBe('1');
      expect(rabbit.finalCount).toBeGreaterThan(0);
    });

    it('first Hare with no others does not pollute standaloneTokens with zero-count entry', () => {
      const hare = makeHareApparent();
      const state = stateWith({ deckCards: [hare] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // No ghost tokens: no entry with finalCount=0 should exist
      const zeroTokens = next.standaloneTokens.filter(t => t.finalCount === 0);
      expect(zeroTokens).toHaveLength(0);
    });
  });

  // =========================================================================
  // CHATTERFANG
  // =========================================================================
  describe('Chatterfang (companion squirrel generation)', () => {
    it('creates Squirrel tokens when another card creates tokens', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [soldier, chatterfang],
        battlefield: [bf(1)], // Chatterfang on battlefield
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // 1 Soldier + 1 Squirrel (from Chatterfang)
      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(1);
    });

    it('creates squirrels equal to TOTAL tokens, not just 1', () => {
      const multi = makeMultiTokenGenerator(3); // creates 3 Soldiers
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [multi, chatterfang],
        battlefield: [bf(1)], // Chatterfang on battlefield
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // 3 Soldiers → Chatterfang creates 3 Squirrels
      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(3);
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(3);
    });

    it('counts total across multiple token TYPES for squirrel count', () => {
      const multiType = makeMultiTypeGenerator(); // 1 Soldier + 1 Treasure
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [multiType, chatterfang],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // 1 Soldier + 1 Treasure = 2 tokens total → 2 Squirrels
      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(2);
    });

    it('Chatterfang creates SQUIRREL tokens, not copies of the original token type', () => {
      const treasure = makeTreasureGenerator();
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [treasure, chatterfang],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      const squirrels = getTokensByName(next.standaloneTokens, 'Squirrel');
      expect(squirrels.length).toBeGreaterThan(0);
      expect(squirrels[0].tokenDef.name).toBe('Squirrel');
      expect(squirrels[0].tokenDef.types).toContain('creature');
      expect(squirrels[0].tokenDef.power).toBe('1');
      expect(squirrels[0].tokenDef.toughness).toBe('1');
      expect(squirrels[0].tokenDef.colors).toContain('green');
    });

    it('does not trigger from its own token creation (no infinite loop)', () => {
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [chatterfang],
        battlefield: [bf(0)],
      });
      const next = appReducer(state, { type: 'TRIGGER_CARD', payload: { deckCardIndex: 0 } });

      // sourceCardIndex === Chatterfang's index → companion skips
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(1);
    });

    it('works with TRIGGER_ALL (landfall)', () => {
      const landfall = makeLandfallGenerator();
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [landfall, chatterfang],
        battlefield: [bf(0), bf(1)],
      });
      const next = appReducer(state, { type: 'TRIGGER_ALL', payload: { triggerTypes: ['landfall'] } });

      expect(totalTokenCount(next.standaloneTokens, 'Plant')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(1);
    });

    it('works with a doubler: squirrel count matches doubled total', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const chatterfang = makeChatterfang();
      const doubler = makeDoubler();
      const state = stateWith({
        deckCards: [soldier, chatterfang, doubler],
        battlefield: [bf(1), bf(2)], // Chatterfang + doubler on battlefield
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // Base: 1 Soldier, doubled → 2 Soldiers
      // Chatterfang sees total=2, creates 2 Squirrels, doubled → 4 Squirrels
      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(2);
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(4);
    });

    it('creates 5 squirrels from 5 token creation (e.g., 5 Soldiers)', () => {
      const multi = makeMultiTokenGenerator(5);
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [multi, chatterfang],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(5);
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(5);
    });

    it('Chatterfang + Treasure: creates 1 Squirrel (not just +1 Treasure)', () => {
      // This is the core bug: Chatterfang should NOT add +1 to existing tokens
      // It should create separate Squirrel tokens
      const treasure = makeTreasureGenerator();
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [treasure, chatterfang],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // Should have BOTH Treasure and Squirrel, not 2 Treasures
      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(1);
      expect(next.standaloneTokens).toHaveLength(2);
    });
  });

  // =========================================================================
  // ACADEMY MANUFACTOR
  // =========================================================================
  describe('Academy Manufactor (Clue/Food/Treasure replacement)', () => {
    it('replaces 1 Treasure with 1 Treasure + 1 Clue + 1 Food', () => {
      const treasure = makeTreasureGenerator();
      const manufactor = makeAcademyManufactor();
      const state = stateWith({
        deckCards: [treasure, manufactor],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Clue')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Food')).toBe(1);
    });

    it('replaces Food with 1 of each', () => {
      const food = makeFoodGenerator();
      const manufactor = makeAcademyManufactor();
      const state = stateWith({
        deckCards: [food, manufactor],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Clue')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Food')).toBe(1);
    });

    it('replaces Clue with 1 of each', () => {
      const clue = makeClueGenerator();
      const manufactor = makeAcademyManufactor();
      const state = stateWith({
        deckCards: [clue, manufactor],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Clue')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Food')).toBe(1);
    });

    it('does NOT affect non-artifact tokens (Soldiers stay as Soldiers)', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const manufactor = makeAcademyManufactor();
      const state = stateWith({
        deckCards: [soldier, manufactor],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(0);
      expect(totalTokenCount(next.standaloneTokens, 'Clue')).toBe(0);
      expect(totalTokenCount(next.standaloneTokens, 'Food')).toBe(0);
    });

    it('handles creating 3 Treasures → 3 of each', () => {
      const multiTreasure = makeDeckCard('Triple Treasure', {
        scryfallData: {
          id: uid(), name: 'Triple Treasure',
          oracle_text: 'When Triple Treasure enters, create three Treasure tokens.',
          mana_cost: '{4}', type_line: 'Creature — Human',
        },
        tokens: [{
          count: 3, power: '', toughness: '',
          colors: [], name: 'Treasure', types: ['artifact'],
          keywords: [], rawText: 'three Treasure tokens',
        }],
        triggerInfo: { type: 'etb', label: 'ETB' },
      });
      const manufactor = makeAcademyManufactor();
      const state = stateWith({
        deckCards: [multiTreasure, manufactor],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(3);
      expect(totalTokenCount(next.standaloneTokens, 'Clue')).toBe(3);
      expect(totalTokenCount(next.standaloneTokens, 'Food')).toBe(3);
    });

    it('2 Manufactors + 1 Treasure = 3 of each (per MTG rulings)', () => {
      // Per MTG rulings: with 2 Academy Manufactors, creating 1 Treasure:
      // 1st Manufactor: 1 Treasure → +1 Clue, +1 Food (pool: 1T, 1C, 1F)
      // 2nd Manufactor sees pool of 1T+1C+1F, each triggers "one of each":
      //   Treasure → +1 Clue, +1 Food
      //   Clue → +1 Treasure, +1 Food
      //   Food → +1 Treasure, +1 Clue
      // Final: 3 Treasure + 3 Clue + 3 Food = 9 total
      const treasure = makeTreasureGenerator();
      const manufactor1 = makeAcademyManufactor();
      const manufactor2 = makeAcademyManufactor();
      const state = stateWith({
        deckCards: [treasure, manufactor1, manufactor2],
        battlefield: [bf(1), bf(2)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(3);
      expect(totalTokenCount(next.standaloneTokens, 'Clue')).toBe(3);
      expect(totalTokenCount(next.standaloneTokens, 'Food')).toBe(3);
    });

    it('3 Manufactors + 1 Treasure = 9 of each (per MTG rulings)', () => {
      // 3rd Manufactor processes the 9 tokens from previous 2 Manufactors:
      // 3T+3C+3F each triggers one-of-each →
      //   3T → +3C, +3F
      //   3C → +3T, +3F
      //   3F → +3T, +3C
      // Final: 9 Treasure + 9 Clue + 9 Food = 27 total
      const treasure = makeTreasureGenerator();
      const m1 = makeAcademyManufactor();
      const m2 = makeAcademyManufactor();
      const m3 = makeAcademyManufactor();
      const state = stateWith({
        deckCards: [treasure, m1, m2, m3],
        battlefield: [bf(1), bf(2), bf(3)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(9);
      expect(totalTokenCount(next.standaloneTokens, 'Clue')).toBe(9);
      expect(totalTokenCount(next.standaloneTokens, 'Food')).toBe(9);
    });

    it('handles Treasure + Food card with Manufactor', () => {
      const multiType = makeDeckCard('Artifact Maker', {
        scryfallData: {
          id: uid(), name: 'Artifact Maker',
          oracle_text: 'When Artifact Maker enters, create a Treasure token and a Food token.',
          mana_cost: '{3}', type_line: 'Creature — Human',
        },
        tokens: [
          { count: 1, power: '', toughness: '', colors: [], name: 'Treasure', types: ['artifact'], keywords: [], rawText: 'a Treasure token' },
          { count: 1, power: '', toughness: '', colors: [], name: 'Food', types: ['artifact'], keywords: [], rawText: 'a Food token' },
        ],
        triggerInfo: { type: 'etb', label: 'ETB' },
      });
      const manufactor = makeAcademyManufactor();
      const state = stateWith({
        deckCards: [multiType, manufactor],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // Original: 1 Treasure + 1 Food
      // Manufactor for Treasure: +1 Clue, +1 Food
      // Manufactor for Food: +1 Treasure, +1 Clue
      // Total: 2 Treasure, 2 Food, 2 Clue
      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(2);
      expect(totalTokenCount(next.standaloneTokens, 'Food')).toBe(2);
      expect(totalTokenCount(next.standaloneTokens, 'Clue')).toBe(2);
    });
  });

  // =========================================================================
  // CHATTERFANG + ACADEMY MANUFACTOR INTERACTIONS
  // =========================================================================
  describe('Chatterfang + Academy Manufactor interactions', () => {
    it('Chatterfang sees all tokens including Manufactor output', () => {
      const treasure = makeTreasureGenerator();
      const manufactor = makeAcademyManufactor();
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [treasure, manufactor, chatterfang],
        battlefield: [bf(1), bf(2)], // Both on battlefield
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // Base: 1 Treasure
      // Manufactor: +1 Clue, +1 Food → total 3 tokens
      // Chatterfang sees all 3 → 3 Squirrels
      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Clue')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Food')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(3);
    });

    it('Chatterfang + Manufactor + doubler', () => {
      const treasure = makeTreasureGenerator();
      const manufactor = makeAcademyManufactor();
      const chatterfang = makeChatterfang();
      const doubler = makeDoubler();
      const state = stateWith({
        deckCards: [treasure, manufactor, chatterfang, doubler],
        battlefield: [bf(1), bf(2), bf(3)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // Base: 1 Treasure, doubled → 2
      // Manufactor: Clue & Food each with finalCount=2, doubled → 4 each
      // Chatterfang: sees 2+4+4 = 10 tokens total → 10 Squirrels, doubled → 20
      const treasureCount = totalTokenCount(next.standaloneTokens, 'Treasure');
      const squirrelCount = totalTokenCount(next.standaloneTokens, 'Squirrel');
      expect(treasureCount).toBe(2);
      expect(squirrelCount).toBeGreaterThanOrEqual(10); // At minimum based on all tokens
    });
  });

  // =========================================================================
  // SUPPORT CARD INTERACTIONS WITH TOKEN GENERATION
  // =========================================================================
  describe('Support card interactions', () => {
    it('doubler doubles token count', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const doubler = makeDoubler();
      const state = stateWith({
        deckCards: [soldier, doubler],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(2);
    });

    it('adder adds 1 to token count', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const adder = makeAdder();
      const state = stateWith({
        deckCards: [soldier, adder],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(2);
    });

    it('adder + doubler: adds first, then doubles = (1+1)*2 = 4', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const adder = makeAdder();
      const doubler = makeDoubler();
      const state = stateWith({
        deckCards: [soldier, adder, doubler],
        battlefield: [bf(1), bf(2)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(4);
    });

    it('creature-only doubler does not affect Treasure tokens', () => {
      const treasure = makeTreasureGenerator();
      const creatureDoubler = makeCreatureDoubler();
      const state = stateWith({
        deckCards: [treasure, creatureDoubler],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(1);
    });

    it('creature-only doubler doubles Soldier tokens', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const creatureDoubler = makeCreatureDoubler();
      const state = stateWith({
        deckCards: [soldier, creatureDoubler],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(2);
    });

    it('two doublers: 1 * 2 * 2 = 4', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const doubler1 = makeDoubler('Doubler A');
      const doubler2 = makeDoubler('Doubler B');
      const state = stateWith({
        deckCards: [soldier, doubler1, doubler2],
        battlefield: [bf(1), bf(2)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(4);
    });
  });

  // =========================================================================
  // HARE APPARENT + CHATTERFANG
  // =========================================================================
  describe('Hare Apparent + Chatterfang', () => {
    it('Chatterfang creates squirrels from Hare Apparent rabbits', () => {
      const hare = makeHareApparent();
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [hare, chatterfang],
        battlefield: [bf(0), bf(0), bf(1)], // 2 Hares + Chatterfang
      });
      // Playing 3rd Hare: eachSees = 2+1-1 = 2 → 2 Rabbits
      // Chatterfang: totalTokens = 2 → 2 Squirrels
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Rabbit')).toBe(2);
      expect(totalTokenCount(next.standaloneTokens, 'Squirrel')).toBe(2);
    });

    it('first Hare with 0 rabbits: Chatterfang also creates 0 squirrels', () => {
      const hare = makeHareApparent();
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [hare, chatterfang],
        battlefield: [bf(1)], // Only Chatterfang
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(next.standaloneTokens).toHaveLength(0);
    });
  });

  // =========================================================================
  // HARE APPARENT + DOUBLER
  // =========================================================================
  describe('Hare Apparent + doubler', () => {
    it('doubler doubles Hare Apparent rabbit count', () => {
      const hare = makeHareApparent();
      const doubler = makeDoubler();
      const state = stateWith({
        deckCards: [hare, doubler],
        battlefield: [bf(0), bf(0), bf(1)], // 2 Hares + doubler
      });
      // Playing 3rd Hare: eachSees = 2+1-1 = 2, doubled → 4 Rabbits
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Rabbit')).toBe(4);
    });
  });

  // =========================================================================
  // EDGE CASES
  // =========================================================================
  describe('Edge cases', () => {
    it('no support cards: plain token creation works', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const state = stateWith({ deckCards: [soldier] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(next.standaloneTokens).toHaveLength(1);
      expect(next.standaloneTokens[0].finalCount).toBe(1);
      expect(next.standaloneTokens[0].tokenDef.name).toBe('Soldier');
    });

    it('non-ETB card does not create tokens on play', () => {
      const landfall = makeLandfallGenerator();
      const state = stateWith({ deckCards: [landfall] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(next.standaloneTokens).toHaveLength(0);
      expect(next.battlefield).toHaveLength(1);
    });

    it('instant/sorcery does not add to battlefield', () => {
      const instant = makeDeckCard('Token Spell', {
        scryfallData: {
          id: uid(), name: 'Token Spell',
          oracle_text: 'Create two 1/1 white Soldier creature tokens.',
          mana_cost: '{2}{W}', type_line: 'Sorcery',
        },
        tokens: [{
          count: 2, power: '1', toughness: '1',
          colors: ['white'], name: 'Soldier', types: ['creature'],
          keywords: [], rawText: 'two 1/1 white Soldier creature tokens',
        }],
        triggerInfo: undefined,
      });
      const state = stateWith({ deckCards: [instant] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(next.battlefield).toHaveLength(0);
      expect(next.standaloneTokens).toHaveLength(1);
      expect(next.standaloneTokens[0].finalCount).toBe(2);
    });

    it('X value is used when card has count=-1', () => {
      const xCard = makeDeckCard('X Token Maker', {
        tokens: [{
          count: -1, power: '1', toughness: '1',
          colors: ['white'], name: 'Soldier', types: ['creature'],
          keywords: [], rawText: 'X Soldiers',
        }],
      });
      const state = stateWith({ deckCards: [xCard] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0, xValue: 5 } });

      expect(next.standaloneTokens[0].finalCount).toBe(5);
    });

    it('token finalCount 0 does not create a StandaloneToken entry', () => {
      const hare = makeHareApparent();
      const chatterfang = makeChatterfang();
      const state = stateWith({
        deckCards: [hare, chatterfang],
        battlefield: [bf(1)], // Only Chatterfang, no other Hares
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      // No tokens with count 0 should exist
      expect(next.standaloneTokens).toHaveLength(0);
    });

    it('multiple token types on one card each get processed', () => {
      const multiType = makeMultiTypeGenerator();
      const state = stateWith({ deckCards: [multiType] });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(totalTokenCount(next.standaloneTokens, 'Soldier')).toBe(1);
      expect(totalTokenCount(next.standaloneTokens, 'Treasure')).toBe(1);
    });

    it('TRIGGER_ALL with no matching triggers returns unchanged state', () => {
      const etbCard = makeDeckCard('ETB Only');
      const state = stateWith({
        deckCards: [etbCard],
        battlefield: [bf(0)],
      });
      const next = appReducer(state, { type: 'TRIGGER_ALL', payload: { triggerTypes: ['landfall'] } });

      expect(next).toBe(state);
    });

    it('breakdown string is generated', () => {
      const soldier = makeDeckCard('Soldier Maker');
      const doubler = makeDoubler();
      const state = stateWith({
        deckCards: [soldier, doubler],
        battlefield: [bf(1)],
      });
      const next = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });

      expect(next.standaloneTokens[0].breakdown).toContain('×');
      expect(next.standaloneTokens[0].breakdown).toContain('= 2');
    });
  });

  // =========================================================================
  // FULL GAME SCENARIOS
  // =========================================================================
  describe('Full game scenarios', () => {
    it('Turn sequence: play Chatterfang, then Hare x3', () => {
      const hare = makeHareApparent();
      const chatterfang = makeChatterfang();
      const deckCards = [hare, chatterfang];

      // Turn 1: Play Chatterfang
      let state = stateWith({ deckCards });
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 1 } });
      expect(state.battlefield).toHaveLength(1);
      expect(state.standaloneTokens).toHaveLength(0);

      // Turn 2: Play first Hare (0 others → 0 rabbits, 0 squirrels)
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(state.battlefield).toHaveLength(2);
      expect(state.standaloneTokens).toHaveLength(0); // No zero-count ghost tokens

      // Turn 3: Play second Hare (1 other → 1 rabbit → 1 squirrel)
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(state.battlefield).toHaveLength(3);
      expect(totalTokenCount(state.standaloneTokens, 'Rabbit')).toBe(1);
      expect(totalTokenCount(state.standaloneTokens, 'Squirrel')).toBe(1);

      // Turn 4: Play third Hare (2 others → 2 rabbits → 2 squirrels)
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(state.battlefield).toHaveLength(4);
      expect(totalTokenCount(state.standaloneTokens, 'Rabbit')).toBe(3); // 0+1+2
      expect(totalTokenCount(state.standaloneTokens, 'Squirrel')).toBe(3); // 0+1+2
    });

    it('Turn sequence: Manufactor then multiple treasure sources', () => {
      const treasure1 = makeTreasureGenerator('Treasure Ship');
      const treasure2 = makeTreasureGenerator('Gold Mine');
      const manufactor = makeAcademyManufactor();
      const deckCards = [treasure1, treasure2, manufactor];

      let state = stateWith({ deckCards });
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 2 } });
      expect(state.battlefield).toHaveLength(1);

      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(totalTokenCount(state.standaloneTokens, 'Treasure')).toBe(1);
      expect(totalTokenCount(state.standaloneTokens, 'Clue')).toBe(1);
      expect(totalTokenCount(state.standaloneTokens, 'Food')).toBe(1);

      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 1 } });
      expect(totalTokenCount(state.standaloneTokens, 'Treasure')).toBe(2);
      expect(totalTokenCount(state.standaloneTokens, 'Clue')).toBe(2);
      expect(totalTokenCount(state.standaloneTokens, 'Food')).toBe(2);
    });

    it('Turn sequence: Chatterfang + Manufactor + Treasure', () => {
      const treasure = makeTreasureGenerator();
      const manufactor = makeAcademyManufactor();
      const chatterfang = makeChatterfang();
      const deckCards = [treasure, manufactor, chatterfang];

      let state = stateWith({ deckCards });
      // Play Manufactor
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 1 } });
      // Play Chatterfang
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 2 } });
      expect(state.battlefield).toHaveLength(2);

      // Play Treasure source:
      // 1 Treasure → Manufactor adds 1 Clue + 1 Food (3 total)
      // Chatterfang sees 3 total → 3 Squirrels
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(totalTokenCount(state.standaloneTokens, 'Treasure')).toBe(1);
      expect(totalTokenCount(state.standaloneTokens, 'Clue')).toBe(1);
      expect(totalTokenCount(state.standaloneTokens, 'Food')).toBe(1);
      expect(totalTokenCount(state.standaloneTokens, 'Squirrel')).toBe(3);
    });

    it('Big board: Chatterfang + 2 Manufactors + Treasure = massive output', () => {
      const treasure = makeTreasureGenerator();
      const m1 = makeAcademyManufactor();
      const m2 = makeAcademyManufactor();
      const chatterfang = makeChatterfang();
      const deckCards = [treasure, m1, m2, chatterfang];

      let state = stateWith({ deckCards });
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 1 } });
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 2 } });
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 3 } });

      // Play Treasure: 2 Manufactors → 3T+3C+3F = 9 artifacts
      // Chatterfang sees 9 → 9 Squirrels
      state = appReducer(state, { type: 'PLAY_CARD', payload: { deckCardIndex: 0 } });
      expect(totalTokenCount(state.standaloneTokens, 'Treasure')).toBe(3);
      expect(totalTokenCount(state.standaloneTokens, 'Clue')).toBe(3);
      expect(totalTokenCount(state.standaloneTokens, 'Food')).toBe(3);
      expect(totalTokenCount(state.standaloneTokens, 'Squirrel')).toBe(9);
    });
  });
});
