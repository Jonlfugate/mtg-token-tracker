import type { DeckCard, TokenCalculationResult } from '../types';

export function calculateTokens(
  generator: DeckCard,
  activeSupportCards: DeckCard[],
  variableX: number = 1,
): TokenCalculationResult[] {
  return generator.tokens.map(tokenDef => {
    const baseCount = tokenDef.count === -1 ? variableX : tokenDef.count;

    // Sort: additional effects first, then multipliers
    // This order maximizes output (which is what players typically want)
    const sortedSupport = [...activeSupportCards]
      .filter(s => s.supportEffect)
      .sort((a, b) => {
        if (a.supportEffect!.type === 'additional' && b.supportEffect!.type === 'multiplier') return -1;
        if (a.supportEffect!.type === 'multiplier' && b.supportEffect!.type === 'additional') return 1;
        return 0;
      });

    let count = baseCount;
    const breakdownParts: string[] = [String(baseCount)];
    const activeMultipliers: TokenCalculationResult['activeMultipliers'] = [];

    for (const support of sortedSupport) {
      const effect = support.supportEffect!;

      // Check condition match (e.g., "creature tokens" only)
      if (effect.condition === 'creature tokens' && !tokenDef.types.includes('creature')) {
        continue;
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
