import { describe, it, expect } from 'vitest';
import { detectSupport } from '../supportDetector';
import type { ScryfallCard } from '../../types';

function makeCard(oracle_text: string): ScryfallCard {
  return {
    id: 'test', name: 'Test Card', oracle_text,
    mana_cost: '{2}', type_line: 'Enchantment',
  };
}

describe('detectSupport', () => {
  it('detects "twice that many" as multiplier x2', () => {
    const card = makeCard('If an effect would create one or more tokens, it creates twice that many of those tokens instead.');
    const result = detectSupport(card);
    expect(result).toBeDefined();
    expect(result!.type).toBe('multiplier');
    expect(result!.factor).toBe(2);
  });

  it('detects "double the number" as multiplier x2', () => {
    const card = makeCard('If you would create one or more tokens, double the number of those tokens created instead.');
    const result = detectSupport(card);
    expect(result!.type).toBe('multiplier');
    expect(result!.factor).toBe(2);
  });

  it('detects "an additional token" as additional +1', () => {
    const card = makeCard('If one or more tokens would be created, an additional token of any type is created.');
    const result = detectSupport(card);
    expect(result!.type).toBe('additional');
    expect(result!.factor).toBe(1);
  });

  it('detects creature token condition', () => {
    const card = makeCard('If an effect would create one or more creature tokens, it creates twice that many of those creature tokens instead.');
    const result = detectSupport(card);
    expect(result!.condition).toBe('creature tokens');
  });

  it('returns undefined for non-support cards', () => {
    const card = makeCard('Destroy target creature.');
    const result = detectSupport(card);
    expect(result).toBeUndefined();
  });

  it('detects Academy Manufactor as companion support', () => {
    const card = makeCard(
      'If you would create a Clue, Food, or Treasure token, instead create one of each of those tokens.'
    );
    const result = detectSupport(card);
    expect(result).toBeDefined();
    expect(result!.type).toBe('companion');
    expect(result!.factor).toBe(1);
  });

  it('detects Chatterfang (real oracle text) as companion support', () => {
    // Real Scryfall oracle text for Chatterfang, Squirrel General
    const card = makeCard(
      'Forestwalk (This creature can\'t be blocked as long as defending player controls a Forest.)\nIf one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.\n{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.'
    );
    const result = detectSupport(card);
    expect(result).toBeDefined();
    expect(result!.type).toBe('companion');
    expect(result!.factor).toBe(1);
  });

  it('detects Chatterfang (alternative wording) as companion support', () => {
    // Alternative/older wording style
    const card = makeCard(
      'Whenever you create one or more tokens, also create that many 1/1 green Squirrel creature tokens.'
    );
    const result = detectSupport(card);
    expect(result).toBeDefined();
    expect(result!.type).toBe('companion');
    expect(result!.factor).toBe(1);
  });

  it('detects Mondrak as multiplier x2 (real oracle text)', () => {
    const card = makeCard(
      'If one or more tokens would be created under your control, twice that many of those tokens are created instead.\n{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on Mondrak.'
    );
    const result = detectSupport(card);
    expect(result).toBeDefined();
    expect(result!.type).toBe('multiplier');
    expect(result!.factor).toBe(2);
  });

  it('detects Academy Manufactor (real oracle text) as companion', () => {
    // Real Scryfall oracle text (shorter than previous test)
    const card = makeCard(
      'If you would create a Clue, Food, or Treasure token, instead create one of each.'
    );
    const result = detectSupport(card);
    expect(result).toBeDefined();
    expect(result!.type).toBe('companion');
    expect(result!.factor).toBe(1);
  });
});
