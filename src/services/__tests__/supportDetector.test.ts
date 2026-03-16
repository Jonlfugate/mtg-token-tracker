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
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('multiplier');
    expect(results[0].factor).toBe(2);
  });

  it('detects "double the number" as multiplier x2', () => {
    const card = makeCard('If you would create one or more tokens, double the number of those tokens created instead.');
    const results = detectSupport(card);
    expect(results[0].type).toBe('multiplier');
    expect(results[0].factor).toBe(2);
  });

  it('detects "an additional token" as additional +1', () => {
    const card = makeCard('If one or more tokens would be created, an additional token of any type is created.');
    const results = detectSupport(card);
    expect(results[0].type).toBe('additional');
    expect(results[0].factor).toBe(1);
  });

  it('detects creature token condition', () => {
    const card = makeCard('If an effect would create one or more creature tokens, it creates twice that many of those creature tokens instead.');
    const results = detectSupport(card);
    expect(results[0].condition).toBe('creature tokens');
  });

  it('returns empty array for non-support cards', () => {
    const card = makeCard('Destroy target creature.');
    const results = detectSupport(card);
    expect(results).toHaveLength(0);
  });

  it('detects Academy Manufactor as companion support', () => {
    const card = makeCard(
      'If you would create a Clue, Food, or Treasure token, instead create one of each of those tokens.'
    );
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('companion');
    expect(results[0].factor).toBe(1);
  });

  it('detects Chatterfang (real oracle text) as companion support', () => {
    const card = makeCard(
      'Forestwalk (This creature can\'t be blocked as long as defending player controls a Forest.)\nIf one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.\n{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.'
    );
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('companion');
    expect(results[0].factor).toBe(1);
  });

  it('detects Chatterfang (alternative wording) as companion support', () => {
    const card = makeCard(
      'Whenever you create one or more tokens, also create that many 1/1 green Squirrel creature tokens.'
    );
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('companion');
    expect(results[0].factor).toBe(1);
  });

  it('detects Mondrak as multiplier x2 (real oracle text)', () => {
    const card = makeCard(
      'If one or more tokens would be created under your control, twice that many of those tokens are created instead.\n{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on Mondrak.'
    );
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('multiplier');
    expect(results[0].factor).toBe(2);
  });

  it('detects Academy Manufactor (real oracle text) as companion', () => {
    const card = makeCard(
      'If you would create a Clue, Food, or Treasure token, instead create one of each.'
    );
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('companion');
    expect(results[0].factor).toBe(1);
  });

  it('detects Adrix and Nev ("token is created twice instead") as multiplier x2', () => {
    const card = makeCard(
      'If one or more tokens would be created under your control, twice that many of those tokens are created instead.'
    );
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('multiplier');
    expect(results[0].factor).toBe(2);
  });

  it('detects Adrix and Nev alternate wording ("that token is created twice instead")', () => {
    const card = makeCard(
      'If a token would be created under your control, that token is created twice instead.'
    );
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('multiplier');
    expect(results[0].factor).toBe(2);
  });

  it('returns multiple effects from multi-ability cards', () => {
    const card = makeCard(
      'If one or more tokens would be created under your control, twice that many of those tokens are created instead.\nIf you would create a Clue, Food, or Treasure token, instead create one of each.'
    );
    const results = detectSupport(card);
    expect(results.length).toBe(2);
    expect(results[0].type).toBe('multiplier');
    expect(results[1].type).toBe('companion');
  });

  it('does not duplicate same effect type from same ability', () => {
    const card = makeCard(
      'If one or more tokens would be created under your control, twice that many of those tokens are created instead.'
    );
    const results = detectSupport(card);
    expect(results).toHaveLength(1);
  });

  it('Academy Manufactor: condition is undefined (not restricted to one artifact type)', () => {
    const card = makeCard(
      'If you would create a Clue, Food, or Treasure token, instead create one of each of those tokens.'
    );
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].condition).toBeUndefined();
  });

  it('Xorn: condition is restricted to treasure tokens only', () => {
    const card = makeCard(
      'If you would create one or more Treasure tokens, instead create that many plus one Treasure tokens.'
    );
    const results = detectSupport(card);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].condition).toBe('treasure tokens');
  });

  it('detects Xorn as additional +1', () => {
    const card = makeCard(
      'If you would create one or more Treasure tokens, instead create that many plus one Treasure tokens.'
    );
    const results = detectSupport(card);
    expect(results[0].type).toBe('additional');
    expect(results[0].factor).toBe(1);
  });
});
