import { describe, it, expect } from 'vitest';
import { detectTokens } from '../tokenDetector';
import type { ScryfallCard, ScryfallTokenData } from '../../types';

function makeCard(oracle_text: string, name = 'Test Card'): ScryfallCard {
  return {
    id: 'test-id',
    name,
    oracle_text,
    mana_cost: '{1}{W}',
    type_line: 'Creature — Human',
    keywords: [],
  };
}

function makeTokenData(overrides: Partial<ScryfallTokenData> = {}): ScryfallTokenData {
  return {
    name: 'Soldier',
    power: '1',
    toughness: '1',
    colors: ['white'],
    type_line: 'Token Creature — Soldier',
    keywords: [],
    ...overrides,
  };
}

describe('detectTokens', () => {
  describe('basic token creation', () => {
    it('detects "create a token" with count word', () => {
      const card = makeCard('When Test Card enters, create two 1/1 white Soldier creature tokens.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].count).toBe(2);
      expect(tokens[0].power).toBe('1');
      expect(tokens[0].toughness).toBe('1');
    });

    it('detects "creates" (third person) form', () => {
      const card = makeCard('Whenever a creature dies, Test Card creates a 1/1 black Zombie creature token.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].count).toBe(1);
    });

    it('uses Scryfall token data when available', () => {
      const card = makeCard('When Test Card enters, create a 1/1 white Soldier creature token.');
      const tokenData = [makeTokenData({ name: 'Soldier', power: '1', toughness: '1', colors: ['white'] })];
      const tokens = detectTokens(card, tokenData);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe('Soldier');
      expect(tokens[0].colors).toEqual(['white']);
    });

    it('detects numeric count', () => {
      const card = makeCard('Create 3 1/1 white Soldier creature tokens.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].count).toBe(3);
    });
  });

  describe('predefined artifact tokens', () => {
    it('detects Treasure tokens', () => {
      const card = makeCard('When Test Card enters, create a Treasure token.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe('Treasure');
      expect(tokens[0].types).toContain('artifact');
    });

    it('detects Food tokens', () => {
      const card = makeCard('When Test Card enters, create two Food tokens.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe('Food');
      expect(tokens[0].count).toBe(2);
    });

    it('detects Clue tokens', () => {
      const card = makeCard('Whenever a creature enters, create a Clue token.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe('Clue');
    });

    it('detects Blood tokens', () => {
      const card = makeCard('Create a Blood token.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe('Blood');
    });
  });

  describe('variable count tokens', () => {
    it('detects X count tokens', () => {
      const card = makeCard('Create X 1/1 white Soldier creature tokens.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].count).toBe(-1);
    });

    it('detects "for each" variable count', () => {
      const card = makeCard('Create a 1/1 white Soldier creature token for each creature you control.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].count).toBe(-1);
    });
  });

  describe('conditional "instead" tokens', () => {
    it('detects conditional replacement token', () => {
      const card = makeCard(
        'At the beginning of your upkeep, create a 1/1 white Spirit creature token with flying.\n' +
        'If you\'re the monarch, create a 4/4 white Angel creature token with flying instead.'
      );
      const tokens = detectTokens(card);
      expect(tokens.length).toBeGreaterThanOrEqual(2);

      const spirit = tokens.find(t => t.name.toLowerCase().includes('spirit') || (t.power === '1' && !t.isConditional));
      const angel = tokens.find(t => t.isConditional);
      expect(spirit).toBeDefined();
      expect(angel).toBeDefined();
      expect(angel!.isReplacement).toBe(true);
    });
  });

  describe('copy tokens', () => {
    it('detects "create a token that\'s a copy of"', () => {
      const card = makeCard('Create a token that\'s a copy of target creature.', 'Clone Guy');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toMatch(/^Copy of/);
    });

    it('handles self-referential copy ("copy of itself")', () => {
      const card = makeCard(
        'If you control six or more lands, create a token that\'s a copy of Scute Swarm instead.',
        'Scute Swarm'
      );
      const tokens = detectTokens(card);
      const copyToken = tokens.find(t => t.name.includes('Copy of'));
      expect(copyToken).toBeDefined();
      expect(copyToken!.name).toBe('Copy of Scute Swarm');
      expect(copyToken!.isConditional).toBe(true);
    });

    it('does not produce duplicate checkbox for Scute Swarm conditional copy', () => {
      const card = makeCard(
        'Landfall — Whenever a land you control enters, create a 1/1 green Insect creature token.\nIf you control six or more lands, create a token that\'s a copy of Scute Swarm instead.',
        'Scute Swarm'
      );
      const tokens = detectTokens(card);
      // Should have exactly one insect and one copy, not two conditionals
      const conditionals = tokens.filter(t => t.isConditional);
      expect(conditionals).toHaveLength(1);
      expect(conditionals[0].name).toBe('Copy of Scute Swarm');
    });
  });

  describe('self-copies countMode', () => {
    it('detects "for each...named [card name]" as self-copies', () => {
      const card = makeCard(
        'When Hare Apparent enters, create a 1/1 white Rabbit creature token for each creature you control named Hare Apparent.',
        'Hare Apparent'
      );
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].countMode).toBe('self-copies');
      expect(tokens[0].count).toBe(0);
    });
  });

  describe('keyword mechanics', () => {
    it('detects fabricate', () => {
      const card = makeCard('Fabricate 2');
      card.type_line = 'Artifact Creature — Construct';
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe('Servo');
      expect(tokens[0].count).toBe(2);
      expect(tokens[0].isConditional).toBe(true);
    });

    it('detects amass', () => {
      const card = makeCard('Amass Orcs 3');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe('Orcs Army');
      expect(tokens[0].count).toBe(3);
    });

    it('detects incubate', () => {
      const card = makeCard('Incubate 3');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].name).toBe('Incubator');
    });
  });

  describe('modal cards', () => {
    it('marks tokens as conditional on modal cards', () => {
      const card = makeCard(
        'Choose one —\n• Create a 1/1 white Soldier creature token.\n• Create a Treasure token.'
      );
      const tokens = detectTokens(card);
      expect(tokens.length).toBeGreaterThanOrEqual(1);
      for (const t of tokens) {
        expect(t.isConditional).toBe(true);
      }
    });
  });

  describe('multi-face cards', () => {
    it('reads oracle text from card_faces when oracle_text is missing', () => {
      const card: ScryfallCard = {
        id: 'test',
        name: 'Test DFC',
        oracle_text: '',
        mana_cost: '{2}{W}',
        type_line: 'Creature // Creature',
        card_faces: [
          { name: 'Front', oracle_text: 'Create a 1/1 white Soldier creature token.' },
          { name: 'Back', oracle_text: '' },
        ],
      };
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('returns empty for cards with no token text', () => {
      const card = makeCard('Destroy target creature.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(0);
    });

    it('strips reminder text to avoid double-matching', () => {
      const card = makeCard('Fabricate 1 (When this creature enters, put a +1/+1 counter on it or create a 1/1 colorless Servo artifact creature token.)');
      const tokens = detectTokens(card);
      // Should find exactly 1 servo from fabricate, not 2
      expect(tokens).toHaveLength(1);
    });

    it('does not duplicate tokens from same snippet', () => {
      const card = makeCard('Create a 1/1 white Soldier creature token.\nCreate a 1/1 white Soldier creature token.');
      const tokens = detectTokens(card);
      expect(tokens).toHaveLength(1);
    });
  });
});
