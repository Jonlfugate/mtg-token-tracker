import type { DeckCard, SupportEffect, TokenCalculationResult } from '../types';

/** Flatten all non-companion support effects from support cards, sorted: additionals first, then multipliers */
function collectSupportEffects(supportCards: DeckCard[]): Array<{ card: DeckCard; effect: SupportEffect }> {
  const pairs: Array<{ card: DeckCard; effect: SupportEffect }> = [];
  for (const card of supportCards) {
    for (const effect of card.supportEffects) {
      if (effect.type === 'companion') continue;
      pairs.push({ card, effect });
    }
  }
  // Sort: additional effects first, then multipliers
  // This order maximizes output (which is what players typically want)
  pairs.sort((a, b) => {
    if (a.effect.type === 'additional' && b.effect.type === 'multiplier') return -1;
    if (a.effect.type === 'multiplier' && b.effect.type === 'additional') return 1;
    return 0;
  });
  return pairs;
}

export function calculateTokens(
  generator: DeckCard,
  activeSupportCards: DeckCard[],
  variableX: number = 1,
): TokenCalculationResult[] {
  const supportEffects = collectSupportEffects(activeSupportCards);

  return generator.tokens.map(tokenDef => {
    const baseCount = tokenDef.count === -1 ? variableX : tokenDef.count;

    // Zero-count means "no tokens created this time" (e.g., Hare Apparent with no other copies
    // in play). Support effects must not inflate this to a non-zero value.
    if (baseCount === 0) {
      return {
        sourceCard: generator,
        baseTokens: tokenDef,
        tokenArt: generator.tokenArt.find(a => a.name.toLowerCase() === tokenDef.name.toLowerCase()) ?? generator.tokenArt[0],
        activeMultipliers: [],
        finalCount: 0,
        breakdown: '0',
      };
    }

    let count = baseCount;
    const breakdownParts: string[] = [String(baseCount)];
    const activeMultipliers: TokenCalculationResult['activeMultipliers'] = [];

    for (const { card: support, effect } of supportEffects) {
      // Check condition match
      if (effect.condition) {
        const cond = effect.condition.toLowerCase();
        if (cond === 'creature tokens') {
          // Type-based restriction: only apply to creature tokens
          if (!tokenDef.types.includes('creature')) continue;
        } else if (cond.endsWith(' tokens')) {
          // Named token restriction (e.g., 'treasure tokens' from Xorn)
          const requiredName = cond.slice(0, -' tokens'.length);
          if (tokenDef.name.toLowerCase() !== requiredName) continue;
        }
      }

      activeMultipliers.push({ card: support, effect });

      if (effect.type === 'additional') {
        count += effect.factor;
        breakdownParts.push(`+ ${effect.factor} (${support.scryfallData.name})`);
      } else if (effect.type === 'multiplier') {
        count *= effect.factor;
        breakdownParts.push(`× ${effect.factor} (${support.scryfallData.name})`);
      }
    }

    const breakdown = breakdownParts.join(' ') + ` = ${count}`;

    // Match token art by name
    const matchedArt = generator.tokenArt.find(
      art => art.name.toLowerCase() === tokenDef.name.toLowerCase()
    ) || generator.tokenArt[0]; // fallback to first token art

    return {
      sourceCard: generator,
      baseTokens: tokenDef,
      tokenArt: matchedArt,
      activeMultipliers,
      finalCount: count,
      breakdown,
    };
  });
}
