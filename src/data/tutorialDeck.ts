import type { AppState } from '../types';

/**
 * Decklist fed through the full import pipeline — gets real Scryfall data,
 * detectTokens, detectSupport, detectTriggerType, token art, everything.
 *
 * Card order determines deckCardIndex after the 'other' filter:
 *   0 = Court of Grace      (upkeep, monarch condition)
 *   1 = Adeline             (combat)
 *   2 = Mondrak             (support)
 *   3 = Scute Swarm         (landfall, exponential)
 */
export const TUTORIAL_DECKLIST = `1 Court of Grace
1 Adeline, Resplendent Cathar
1 Mondrak, Glory Dominus
1 Scute Swarm`;

// ── Tutorial step definitions ────────────────────────────────────────────────

export interface TutorialStep {
  title: string;
  body: string;
  /** True = no Next button; step advances automatically when predicate returns true */
  autoAdvance: boolean;
  predicate?: (state: Pick<AppState, 'battlefield' | 'currentTurn' | 'standaloneTokens'>) => boolean;
  /** data-tutorial-target attribute value to spotlight; undefined = no overlay */
  targetAttr?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Welcome to MTG Token Tracker',
    body:
      'A demo deck with 4 cards is loaded. The left panel shows your Decklist — cards are grouped by ' +
      'when they trigger (Upkeep, Landfall, Combat, Support). Click Next to begin.',
    autoAdvance: false,
  },
  {
    title: 'Step 1 — Play a card',
    body:
      'Find "Court of Grace" in the Upkeep section of your Decklist. ' +
      'Enter 1 in the qty field and click Play to put it on the Battlefield.',
    autoAdvance: true,
    predicate: (s) => s.battlefield.some((bc) => bc.deckCardIndex === 0),
    targetAttr: 'deck-section-upkeep',
  },
  {
    title: 'Step 2 — Condition toggles',
    body:
      'Court of Grace creates a 1/1 Spirit normally, but a 4/4 Angel if you\'re the Monarch. ' +
      'Toggle the "Monarch" switch on the card to change which token it creates. Then click New Turn.',
    autoAdvance: true,
    predicate: (s) => s.currentTurn > 1,
    targetAttr: 'new-turn-btn',
  },
  {
    title: 'Your token grid',
    body:
      'Tokens appear in the right panel. Use + and − to adjust counts as tokens are created or ' +
      'removed. The ☠ button on creature tokens records deaths for morbid and similar effects — it resets each turn.',
    autoAdvance: false,
    targetAttr: 'token-battlefield',
  },
  {
    title: 'Step 3 — Support multipliers',
    body:
      'Find "Mondrak, Glory Dominus" in the Support section and click Play. ' +
      'While on the battlefield it doubles all token creation — click New Turn again to see 2 Spirits instead of 1.',
    autoAdvance: true,
    predicate: (s) => s.battlefield.some((bc) => bc.deckCardIndex === 2),
    targetAttr: 'deck-section-support',
  },
  {
    title: 'Step 4 — Play Scute Swarm',
    body:
      'Find "Scute Swarm" in the Landfall section of your Decklist and click Play. ' +
      'Scute Swarm creates Insect tokens on landfall — but with 6+ lands it creates copies of itself instead.',
    autoAdvance: true,
    predicate: (s) => s.battlefield.some((bc) => bc.deckCardIndex === 3),
    targetAttr: 'deck-section-landfall',
  },
  {
    title: 'Step 5 — Switch to 6+ lands mode',
    body:
      'Scute Swarm is now in play. Find it in the "Cards in Play" section and toggle the condition ' +
      'from "Insect" to "Copy of Scute Swarm" — this tells the tracker you control 6 or more lands.',
    autoAdvance: true,
    predicate: (s) =>
      s.battlefield.some(
        (bc) => bc.deckCardIndex === 3 && Object.values(bc.conditionsMet ?? {}).some((v) => v === true),
      ),
    targetAttr: 'battlefield-section-landfall',
  },
  {
    title: 'Step 6 — Click Land Played',
    body:
      'Now click "Land Played" several times. Each land doubles your Scute Swarm count — ' +
      'watch the numbers grow exponentially. Mondrak doubles it further!',
    autoAdvance: true,
    predicate: (s) => s.standaloneTokens.some((t) => t.sourceName === 'Scute Swarm'),
    targetAttr: 'land-played-btn',
  },
  {
    title: "You're ready!",
    body:
      'Adeline (Combat section) needs manual triggering — play her, then click her Trigger button ' +
      'when you attack. Import your own deck using the panel above to get started!',
    autoAdvance: false,
  },
];
