import { describe, it, expect } from 'vitest';
import { calculateTokens } from '../tokenCalculator';
import type { DeckCard, TokenDefinition, SupportEffect } from '../../types';

function makeDeckCard(tokens: TokenDefinition[], supportEffects: SupportEffect[] = []): DeckCard {
  return {
    decklistEntry: { quantity: 1, name: 'Test Card' },
    scryfallData: {
      id: 'test', name: 'Test Card', oracle_text: '', mana_cost: '{1}',
      type_line: 'Creature', keywords: [],
    },
    category: 'token-generator',
    tokens,
    tokenArt: [],
    supportEffects,
  };
}

function makeSupportCard(effect: SupportEffect): DeckCard {
  return {
    decklistEntry: { quantity: 1, name: 'Support Card' },
    scryfallData: {
      id: 'support', name: 'Support Card', oracle_text: '', mana_cost: '{2}',
      type_line: 'Enchantment', keywords: [],
    },
    category: 'support',
    tokens: [],
    tokenArt: [],
    supportEffects: [effect],
  };
}

const soldierToken: TokenDefinition = {
  count: 2, power: '1', toughness: '1',
  colors: ['white'], name: 'Soldier', types: ['creature'],
  keywords: [], rawText: 'two 1/1 white Soldier creature tokens',
};

const treasureToken: TokenDefinition = {
  count: 1, power: '', toughness: '',
  colors: [], name: 'Treasure', types: ['artifact'],
  keywords: [], rawText: 'a Treasure token',
};

describe('calculateTokens', () => {
  it('returns base count with no support cards', () => {
    const card = makeDeckCard([soldierToken]);
    const results = calculateTokens(card, []);
    expect(results).toHaveLength(1);
    expect(results[0].finalCount).toBe(2);
  });

  it('applies additional effect', () => {
    const card = makeDeckCard([soldierToken]);
    const support = makeSupportCard({ type: 'additional', factor: 1, rawText: '+1' });
    const results = calculateTokens(card, [support]);
    expect(results[0].finalCount).toBe(3); // 2 + 1
  });

  it('applies multiplier effect', () => {
    const card = makeDeckCard([soldierToken]);
    const support = makeSupportCard({ type: 'multiplier', factor: 2, rawText: 'x2' });
    const results = calculateTokens(card, [support]);
    expect(results[0].finalCount).toBe(4); // 2 * 2
  });

  it('applies additional before multiplier for maximum output', () => {
    const card = makeDeckCard([soldierToken]);
    const additional = makeSupportCard({ type: 'additional', factor: 1, rawText: '+1' });
    additional.scryfallData.name = 'Adder';
    const multiplier = makeSupportCard({ type: 'multiplier', factor: 2, rawText: 'x2' });
    multiplier.scryfallData.name = 'Doubler';
    const results = calculateTokens(card, [multiplier, additional]); // passed in wrong order
    expect(results[0].finalCount).toBe(6); // (2 + 1) * 2 = 6, not 2 * 2 + 1 = 5
  });

  it('respects "creature tokens" condition on support', () => {
    const card = makeDeckCard([treasureToken]);
    const support = makeSupportCard({
      type: 'additional', factor: 1, condition: 'creature tokens', rawText: '+1 creature',
    });
    const results = calculateTokens(card, [support]);
    expect(results[0].finalCount).toBe(1); // Treasure is not a creature, support doesn't apply
  });

  it('applies "creature tokens" support to creature tokens', () => {
    const card = makeDeckCard([soldierToken]);
    const support = makeSupportCard({
      type: 'additional', factor: 1, condition: 'creature tokens', rawText: '+1 creature',
    });
    const results = calculateTokens(card, [support]);
    expect(results[0].finalCount).toBe(3); // Soldier IS a creature
  });

  it('handles variable X count', () => {
    const xToken: TokenDefinition = { ...soldierToken, count: -1 };
    const card = makeDeckCard([xToken]);
    const results = calculateTokens(card, [], 5);
    expect(results[0].finalCount).toBe(5);
  });

  it('generates breakdown string', () => {
    const card = makeDeckCard([soldierToken]);
    const support = makeSupportCard({ type: 'multiplier', factor: 2, rawText: 'x2' });
    const results = calculateTokens(card, [support]);
    expect(results[0].breakdown).toContain('2');
    expect(results[0].breakdown).toContain('× 2');
    expect(results[0].breakdown).toContain('= 4');
  });

  it('handles multiple token types on one card', () => {
    const card = makeDeckCard([soldierToken, treasureToken]);
    const results = calculateTokens(card, []);
    expect(results).toHaveLength(2);
    expect(results[0].finalCount).toBe(2);
    expect(results[1].finalCount).toBe(1);
  });
});
