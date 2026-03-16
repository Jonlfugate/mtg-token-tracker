/**
 * Regression tests for real-card bugs.
 * Each describe block documents a specific bug and the expected correct behavior.
 * Tests are written against actual Scryfall oracle text.
 */
import { describe, it, expect } from 'vitest';
import { detectTokens } from '../tokenDetector';
import { detectSupport } from '../supportDetector';
import { detectTriggerType } from '../triggerDetector';
import { calculateTokens } from '../tokenCalculator';
import type { ScryfallCard, DeckCard, TokenDefinition, SupportEffect } from '../../types';

function makeCard(name: string, oracle_text: string, type_line: string, mana_cost = '{1}'): ScryfallCard {
  return { id: `id-${name}`, name, oracle_text, mana_cost, type_line, keywords: [] };
}

function makeDeckCard(name: string, tokens: TokenDefinition[], supportEffects: SupportEffect[] = []): DeckCard {
  return {
    decklistEntry: { quantity: 1, name },
    scryfallData: { id: `id-${name}`, name, oracle_text: '', mana_cost: '{1}', type_line: 'Creature', keywords: [] },
    category: 'token-generator',
    tokens,
    tokenArt: [],
    supportEffects,
  };
}

function makeSupportCard(name: string, effects: SupportEffect[]): DeckCard {
  return {
    decklistEntry: { quantity: 1, name },
    scryfallData: { id: `id-${name}`, name, oracle_text: '', mana_cost: '{2}', type_line: 'Enchantment', keywords: [] },
    category: 'support',
    tokens: [],
    tokenArt: [],
    supportEffects: effects,
  };
}

// ---------------------------------------------------------------------------
// BUG: Xorn applies its +1 additional to ALL tokens, not just Treasure tokens
// Expected: Xorn's effect should be condition: 'treasure tokens'
// ---------------------------------------------------------------------------
describe('Xorn — Treasure-specific additional (BUG: affects all tokens)', () => {
  const oracle = 'If you would create one or more Treasure tokens, instead create that many Treasure tokens plus one additional Treasure token.';
  const card = makeCard('Xorn', oracle, 'Creature — Elemental');

  it('support effect should be restricted to Treasure tokens only', () => {
    const effects = detectSupport(card);
    expect(effects).toHaveLength(1);
    expect(effects[0].condition).toBe('treasure tokens');
  });

  it('Xorn should not boost Soldier tokens', () => {
    const soldierToken: TokenDefinition = {
      count: 1, power: '1', toughness: '1', colors: ['white'],
      name: 'Soldier', types: ['creature'], keywords: [], rawText: 'soldier',
    };
    const generator = makeDeckCard('Soldier Maker', [soldierToken]);
    const xornCard = makeSupportCard('Xorn', [
      { type: 'additional', factor: 1, condition: 'treasure tokens', rawText: 'plus one additional Treasure token' },
    ]);
    const results = calculateTokens(generator, [xornCard]);
    expect(results[0].finalCount).toBe(1); // should NOT be 2
  });

  it('Xorn SHOULD boost Treasure tokens', () => {
    const treasureToken: TokenDefinition = {
      count: 1, power: '', toughness: '', colors: [], name: 'Treasure',
      types: ['artifact'], keywords: [], rawText: 'treasure',
    };
    const generator = makeDeckCard('Treasure Maker', [treasureToken]);
    const xornCard = makeSupportCard('Xorn', [
      { type: 'additional', factor: 1, condition: 'treasure tokens', rawText: 'plus one additional Treasure token' },
    ]);
    const results = calculateTokens(generator, [xornCard]);
    expect(results[0].finalCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// BUG: Additionals must not boost zero-count tokens (Hare Apparent with Xorn)
// When Hare Apparent enters as the only copy, it should create 0 tokens.
// With Xorn bugged, 0 base + 1 additional = 1 token — which is impossible.
// ---------------------------------------------------------------------------
describe('Zero-count tokens — additionals must not apply', () => {
  it('a token with base count 0 stays 0 even with an additional effect on the battlefield', () => {
    const rabbitToken: TokenDefinition = {
      count: 0, power: '1', toughness: '1', colors: ['white'],
      name: 'Rabbit', types: ['creature'], keywords: [], rawText: 'rabbit',
    };
    const generator = makeDeckCard('Hare Apparent', [rabbitToken]);
    const booster = makeSupportCard('Bogus Booster', [
      { type: 'additional', factor: 1, rawText: '+1' },
    ]);
    const results = calculateTokens(generator, [booster]);
    expect(results[0].finalCount).toBe(0);
  });

  it('a token with base count 0 stays 0 even with a multiplier', () => {
    const rabbitToken: TokenDefinition = {
      count: 0, power: '1', toughness: '1', colors: ['white'],
      name: 'Rabbit', types: ['creature'], keywords: [], rawText: 'rabbit',
    };
    const generator = makeDeckCard('Hare Apparent', [rabbitToken]);
    const doubler = makeSupportCard('Doubling Season', [
      { type: 'multiplier', factor: 2, rawText: 'twice that many' },
    ]);
    const results = calculateTokens(generator, [doubler]);
    expect(results[0].finalCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BUG: Field of the Dead Zombie token is not marked as conditional
// Expected: Zombie should have isConditional: true (7+ differently named lands)
// Without this, the batch landfall button always creates Zombies unconditionally.
// ---------------------------------------------------------------------------
describe('Field of the Dead — conditional Zombie (BUG: missing condition)', () => {
  const oracle = 'This land enters tapped.\n{T}: Add {C}.\nWhenever this land or another land you control enters, if you control seven or more lands with different names, create a 2/2 black Zombie creature token.';
  const card = makeCard('Field of the Dead', oracle, 'Land', '');

  it('Zombie token should be conditional (7+ lands check)', () => {
    const tokens = detectTokens(card);
    const zombie = tokens.find(t => t.name === 'Zombie');
    expect(zombie).toBeDefined();
    expect(zombie!.isConditional).toBe(true);
  });

  it('Zombie condition should describe the land-count requirement', () => {
    const tokens = detectTokens(card);
    const zombie = tokens.find(t => t.name === 'Zombie');
    expect(zombie).toBeDefined();
    expect(zombie!.conditionType).toBe('board-state');
    expect(zombie!.condition).toMatch(/7\+|seven/i);
  });
});

// ---------------------------------------------------------------------------
// BUG: Forbidden Orchard creates a Spirit token for the opponent,
// but detectTokens picks it up as if WE create it.
// Expected: detectTokens should return [] for Forbidden Orchard.
// ---------------------------------------------------------------------------
describe('Forbidden Orchard — opponent creates the token (BUG: misattributed)', () => {
  const oracle = 'Whenever a player taps Forbidden Orchard for mana, target opponent creates a 1/1 colorless Spirit creature token.';
  const card = makeCard('Forbidden Orchard', oracle, 'Land', '');

  it('should detect no tokens (the Spirit is created by the opponent)', () => {
    const tokens = detectTokens(card);
    expect(tokens).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BUG: Tireless Provisioner "or" choice — only Food is detected, Treasure is missed
// Expected: both tokens detected as mutually exclusive conditional choices
// ---------------------------------------------------------------------------
describe('Tireless Provisioner — "or" choice tokens (BUG: second option missed)', () => {
  const oracle = 'Landfall — Whenever a land you control enters, create a Food token or a Treasure token.';
  const card = makeCard('Tireless Provisioner', oracle, 'Creature — Human Scout', '{2}{G}');

  it('detects both Food and Treasure tokens', () => {
    const tokens = detectTokens(card);
    expect(tokens.find(t => t.name === 'Food')).toBeDefined();
    expect(tokens.find(t => t.name === 'Treasure')).toBeDefined();
  });

  it('both tokens are marked as conditional choices (player picks one)', () => {
    const tokens = detectTokens(card);
    for (const t of tokens) {
      expect(t.isConditional).toBe(true);
    }
  });

  it('Food and Treasure have distinct conditionKeys (mutually exclusive)', () => {
    const tokens = detectTokens(card);
    const keys = tokens.map(t => t.conditionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// BUG: Army tokens (amass) — should stack counters on existing Army token,
// not create new Army tokens each trigger.
// In MTG, you can only have one Army per amass subtype.
// This is a reducer-level concern; the detection side should still work.
// ---------------------------------------------------------------------------
describe('Army tokens — amass detection', () => {
  it('detects Orc Army token from "Amass Orcs N"', () => {
    const card = makeCard('Cut Down', 'Amass Orcs 3.', 'Instant', '{B}');
    const tokens = detectTokens(card);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].name).toBe('Orc Army');
    expect(tokens[0].count).toBe(3);
  });

  it('detects Zombie Army token from "Amass Zombies N"', () => {
    const card = makeCard('Invade the City', 'Amass Zombies 2.', 'Instant', '{2}{U}');
    const tokens = detectTokens(card);
    const army = tokens.find(t => t.name.includes('Army'));
    expect(army).toBeDefined();
    expect(army!.name).toBe('Zombie Army');
  });
});

// ---------------------------------------------------------------------------
// Black Market Connection — all three modes should be detectable
// Mode 1: Treasure token; Mode 3: 2/2 Shapeshifter token.
// Both should be conditional (modal), mutually exclusive.
// ---------------------------------------------------------------------------
describe('Black Market Connection — modal token detection', () => {
  const oracle = 'At the beginning of your precombat main phase, choose one —\n• Create a tapped Treasure token.\n• Draw a card and lose 1 life.\n• Put a +1/+1 counter on a creature you control. Create a 2/2 black Shapeshifter creature token with changeling.';
  const card = makeCard('Black Market Connection', oracle, 'Enchantment', '{2}{B}');

  it('detects Treasure token (mode 1)', () => {
    const tokens = detectTokens(card);
    const treasure = tokens.find(t => t.name === 'Treasure');
    expect(treasure).toBeDefined();
  });

  it('detects Shapeshifter token (mode 3)', () => {
    const tokens = detectTokens(card);
    const shapeshifter = tokens.find(t => t.name === 'Shapeshifter');
    expect(shapeshifter).toBeDefined();
    expect(shapeshifter!.power).toBe('2');
    expect(shapeshifter!.toughness).toBe('2');
  });

  it('both tokens are modal conditional', () => {
    const tokens = detectTokens(card);
    for (const t of tokens) {
      expect(t.isConditional).toBe(true);
      expect(t.conditionType).toBe('modal');
    }
  });

  it('each modal token has a unique conditionKey', () => {
    const tokens = detectTokens(card);
    const keys = tokens.map(t => t.conditionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// Sokenzan, Crucible of Defiance — Channel ability creates Spirit tokens
// Channel is an instant-speed discard effect (from hand).
// detectTokens should find the Spirit tokens.
// ---------------------------------------------------------------------------
describe('Sokenzan, Crucible of Defiance — Channel creates Spirits', () => {
  const oracle = '{T}: Add {R}.\nChannel — {1}{R}, Discard Sokenzan, Crucible of Defiance: Create two 1/1 colorless Spirit creature tokens with haste.';
  const card = makeCard('Sokenzan, Crucible of Defiance', oracle, 'Legendary Land', '');

  it('detects two Spirit tokens from Channel ability', () => {
    const tokens = detectTokens(card);
    const spirit = tokens.find(t => t.name === 'Spirit');
    expect(spirit).toBeDefined();
    expect(spirit!.count).toBe(2);
    expect(spirit!.keywords).toContain('haste');
  });

  it('Spirit tokens are conditional (Channel requires discarding)', () => {
    const tokens = detectTokens(card);
    const spirit = tokens.find(t => t.name === 'Spirit');
    expect(spirit).toBeDefined();
    // Channel is an activated/discard ability — token is conditional on that choice
    expect(spirit!.isConditional).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Oketra's Monument — cast trigger creates Warrior tokens
// ---------------------------------------------------------------------------
describe("Oketra's Monument — cast trigger", () => {
  const oracle = "White creature spells you cast cost {1} less to cast.\nWhenever you cast a creature spell, create a 1/1 white Warrior creature token with vigilance.";
  const card = makeCard("Oketra's Monument", oracle, 'Legendary Artifact', '{3}');

  it('detects Warrior token', () => {
    const tokens = detectTokens(card);
    const warrior = tokens.find(t => t.name === 'Warrior');
    expect(warrior).toBeDefined();
    expect(warrior!.power).toBe('1');
    expect(warrior!.toughness).toBe('1');
    expect(warrior!.keywords).toContain('vigilance');
  });

  it('trigger type is cast', () => {
    const trigger = detectTriggerType(card);
    expect(trigger).toBeDefined();
    expect(trigger!.type).toBe('cast');
  });
});

// ---------------------------------------------------------------------------
// Pawn of Ulamog — death trigger creates Eldrazi Spawn tokens
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// BUG: Ocelot Pride — city's blessing was wrongly detected as "instead" replacement,
// making Cat and Copy an or-switch. The real oracle text uses "Then if" (additive),
// so Cat and city's blessing should be TWO INDEPENDENT checkboxes.
// Real oracle: end step trigger, "if you gained life this turn" → Cat.
//              "Then if you have the city's blessing" → copy of each token this turn.
// ---------------------------------------------------------------------------
describe('Ocelot Pride — two independent conditions (gained life + city\'s blessing)', () => {
  const oracle = "First strike, lifelink\nAscend\nAt the beginning of your end step, if you gained life this turn, create a 1/1 white Cat creature token. Then if you have the city's blessing, for each token you control that entered this turn, create a token that's a copy of it.";
  const card = makeCard('Ocelot Pride', oracle, 'Creature — Cat', '{W}');

  it('detects Cat token', () => {
    const tokens = detectTokens(card);
    expect(tokens.find(t => t.name === 'Cat')).toBeDefined();
  });

  it('Cat token is conditional (gained life this turn)', () => {
    const tokens = detectTokens(card);
    const cat = tokens.find(t => t.name === 'Cat');
    expect(cat!.isConditional).toBe(true);
  });

  it('detects city\'s blessing copy-each-token conditional', () => {
    const tokens = detectTokens(card);
    const blessing = tokens.find(t => t.condition === "City's blessing");
    expect(blessing).toBeDefined();
  });

  it('city\'s blessing token is NOT a replacement (not isReplacement)', () => {
    const tokens = detectTokens(card);
    const blessing = tokens.find(t => t.condition === "City's blessing");
    expect(blessing!.isReplacement).toBeFalsy();
  });

  it('Cat and city\'s blessing are NOT in the same or-group (independent checkboxes)', () => {
    const tokens = detectTokens(card);
    const cat = tokens.find(t => t.name === 'Cat');
    const blessing = tokens.find(t => t.condition === "City's blessing");
    // Neither should have an or-group conditionKey
    expect(cat!.conditionKey).not.toMatch(/-or-\d+$/);
    expect(blessing!.conditionKey).toBeDefined();
    // They should have different conditionKey prefixes
    expect(cat!.conditionKey).not.toBe(blessing!.conditionKey);
  });
});

describe('Pawn of Ulamog — death trigger', () => {
  const oracle = "Whenever Pawn of Ulamog or another nontoken Eldrazi you control dies, you may create a 0/1 colorless Eldrazi Spawn creature token with 'Sacrifice this creature: Add {C}.'";
  const card = makeCard('Pawn of Ulamog', oracle, 'Creature — Eldrazi Vampire', '{1}{B}{B}');

  it('detects Eldrazi Spawn token', () => {
    const tokens = detectTokens(card);
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    const spawn = tokens.find(t => t.name.includes('Spawn') || t.name.includes('Eldrazi'));
    expect(spawn).toBeDefined();
    expect(spawn!.power).toBe('0');
    expect(spawn!.toughness).toBe('1');
  });

  it('trigger type is death', () => {
    const trigger = detectTriggerType(card);
    expect(trigger).toBeDefined();
    expect(trigger!.type).toBe('death');
  });
});
