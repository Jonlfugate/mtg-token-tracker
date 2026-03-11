import type { ScryfallCard, DeckCard } from '../types';

export function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces) {
    return card.card_faces.map(f => f.oracle_text || '').join('\n');
  }
  return '';
}

export function splitAbilities(card: ScryfallCard): string[] {
  return getOracleText(card).split('\n').filter(line => line.trim().length > 0);
}

export function isInstantOrSorcery(card: DeckCard): boolean {
  const type = card.scryfallData.type_line.toLowerCase();
  return type.includes('instant') || type.includes('sorcery');
}

export function isTokenGenerator(card: DeckCard): boolean {
  return card.category === 'token-generator' || card.category === 'both';
}

export function isCopyToken(tokenDef: { name: string }): boolean {
  return tokenDef.name.toLowerCase().startsWith('copy of ');
}
