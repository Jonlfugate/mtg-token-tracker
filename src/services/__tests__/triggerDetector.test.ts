import { describe, it, expect } from 'vitest';
import { detectTriggerType } from '../triggerDetector';
import type { ScryfallCard } from '../../types';

function makeCard(oracle_text: string): ScryfallCard {
  return {
    id: 'test', name: 'Test Card', oracle_text,
    mana_cost: '{2}', type_line: 'Creature',
  };
}

describe('detectTriggerType', () => {
  it('detects landfall', () => {
    const card = makeCard('Landfall — Whenever a land you control enters, create a 1/1 green Insect creature token.');
    const result = detectTriggerType(card);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('landfall');
  });

  it('detects upkeep trigger', () => {
    const card = makeCard('At the beginning of your upkeep, create a 1/1 white Spirit creature token with flying.');
    const result = detectTriggerType(card);
    expect(result!.type).toBe('upkeep');
  });

  it('detects combat/attack trigger', () => {
    const card = makeCard('Whenever Test Card attacks, create a 1/1 white Soldier creature token.');
    const result = detectTriggerType(card);
    expect(result!.type).toBe('combat');
  });

  it('detects ETB trigger', () => {
    const card = makeCard('When Test Card enters, create two 1/1 white Soldier creature tokens.');
    const result = detectTriggerType(card);
    expect(result!.type).toBe('etb');
  });

  it('detects tap trigger', () => {
    const card = makeCard('{T}: Create a 1/1 white Soldier creature token.');
    const result = detectTriggerType(card);
    expect(result!.type).toBe('tap');
  });

  it('detects dual trigger (enters or attacks)', () => {
    const card = makeCard('Whenever Test Card enters or attacks, create a 1/1 white Soldier creature token.');
    const result = detectTriggerType(card);
    expect(result!.alsoEtb).toBe(true);
  });

  it('detects fabricate as ETB', () => {
    const card = makeCard('Fabricate 2');
    const result = detectTriggerType(card);
    expect(result!.type).toBe('etb');
  });

  it('returns null for non-token cards', () => {
    const card = makeCard('Destroy target creature.');
    const result = detectTriggerType(card);
    expect(result).toBeNull();
  });

  it('handles modal with preceding trigger context', () => {
    const card = makeCard('At the beginning of your upkeep, choose one —\n• Create a 1/1 white Spirit creature token with flying.\n• Create a 4/4 white Angel creature token with flying.');
    const result = detectTriggerType(card);
    expect(result!.type).toBe('upkeep');
  });
});
