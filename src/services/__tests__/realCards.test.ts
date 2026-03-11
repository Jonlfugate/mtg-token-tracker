/**
 * Tests for specific real cards to verify detection accuracy.
 * Uses actual Scryfall oracle text.
 */
import { describe, it, expect } from 'vitest';
import { detectTokens } from '../tokenDetector';
import { detectSupport } from '../supportDetector';
import { detectTriggerType } from '../triggerDetector';
import type { ScryfallCard, ScryfallTokenData } from '../../types';

function makeCard(name: string, oracle_text: string, type_line: string, mana_cost = '{1}'): ScryfallCard {
  return { id: `id-${name}`, name, oracle_text, mana_cost, type_line };
}

// ---------------------------------------------------------------------------
// Rhys the Redeemed
// ---------------------------------------------------------------------------
describe('Rhys the Redeemed', () => {
  const oracle = '{2}{G/W}, {T}: Create a 1/1 green and white Elf Warrior creature token.\n{4}{G/W}{G/W}, {T}: For each creature token you control, create a token that\'s a copy of that creature.';
  const card = makeCard('Rhys the Redeemed', oracle, 'Legendary Creature — Elf Warrior', '{G/W}');

  it('detects both token-creating abilities', () => {
    const tokens = detectTokens(card);
    // Should find at least the Elf Warrior token
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    const elfWarrior = tokens.find(t => t.name.includes('Elf') || t.name.includes('Warrior'));
    expect(elfWarrior).toBeDefined();
  });

  it('detects the copy-all-tokens ability', () => {
    const tokens = detectTokens(card);
    const copy = tokens.find(t => t.name.toLowerCase().includes('copy'));
    expect(copy).toBeDefined();
    expect(copy!.isConditional).toBe(true);
  });

  it('is detected as a tap trigger', () => {
    const trigger = detectTriggerType(card);
    expect(trigger).toBeDefined();
    expect(trigger!.type).toBe('tap');
  });

  it('should not be a support card', () => {
    const support = detectSupport(card);
    expect(support).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Ophiomancer
// ---------------------------------------------------------------------------
describe('Ophiomancer', () => {
  const oracle = 'At the beginning of each upkeep, if you control no Snakes, create a 1/1 black Snake creature token with deathtouch.';
  const card = makeCard('Ophiomancer', oracle, 'Creature — Human Shaman', '{2}{B}');
  const snakeData: ScryfallTokenData = {
    name: 'Snake',
    power: '1', toughness: '1',
    colors: ['black'],
    type_line: 'Token Creature — Snake',
    keywords: ['Deathtouch'],
  };

  it('detects Snake token', () => {
    const tokens = detectTokens(card, [snakeData]);
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    const snake = tokens.find(t => t.name === 'Snake');
    expect(snake).toBeDefined();
    expect(snake!.power).toBe('1');
    expect(snake!.toughness).toBe('1');
  });

  it('snake token should have deathtouch keyword', () => {
    const tokens = detectTokens(card, [snakeData]);
    const snake = tokens.find(t => t.name === 'Snake');
    expect(snake).toBeDefined();
    expect(snake!.keywords).toContain('deathtouch');
  });

  it('is detected as upkeep trigger', () => {
    const trigger = detectTriggerType(card);
    expect(trigger).toBeDefined();
    expect(trigger!.type).toBe('upkeep');
  });

  it('snake creation should be conditional (only if you control no Snakes)', () => {
    const tokens = detectTokens(card, [snakeData]);
    const snake = tokens.find(t => t.name === 'Snake');
    expect(snake).toBeDefined();
    expect(snake!.isConditional).toBe(true);
    expect(snake!.condition).toBe('No Snakes');
  });
});

// ---------------------------------------------------------------------------
// Field of the Dead
// ---------------------------------------------------------------------------
describe('Field of the Dead', () => {
  const oracle = 'This land enters tapped.\n{T}: Add {C}.\nWhenever this land or another land you control enters, if you control seven or more lands with different names, create a 2/2 black Zombie creature token.';
  const card = makeCard('Field of the Dead', oracle, 'Land', '');
  const zombieData: ScryfallTokenData = {
    name: 'Zombie',
    power: '2', toughness: '2',
    colors: ['black'],
    type_line: 'Token Creature — Zombie',
    keywords: [],
  };

  it('detects Zombie token', () => {
    const tokens = detectTokens(card, [zombieData]);
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    const zombie = tokens.find(t => t.name === 'Zombie');
    expect(zombie).toBeDefined();
    expect(zombie!.power).toBe('2');
    expect(zombie!.toughness).toBe('2');
  });

  it('is detected as landfall trigger (NOT tap)', () => {
    const trigger = detectTriggerType(card);
    expect(trigger).toBeDefined();
    // The token-creating ability is landfall, not the {T}: Add {C} mana ability
    expect(trigger!.type).toBe('landfall');
  });

  it('Rhys Elf Warrior token is also conditional (multiple activated abilities)', () => {
    // When a card has multiple activated abilities, each token should be conditional
    const rhysCard = makeCard('Rhys the Redeemed',
      '{2}{G/W}, {T}: Create a 1/1 green and white Elf Warrior creature token.\n{4}{G/W}{G/W}, {T}: For each creature token you control, create a token that\'s a copy of that creature.',
      'Legendary Creature — Elf Warrior', '{G/W}');
    const tokens = detectTokens(rhysCard);
    const elfWarrior = tokens.find(t => !t.name.toLowerCase().includes('copy'));
    expect(elfWarrior).toBeDefined();
    expect(elfWarrior!.isConditional).toBe(true);
  });
});
