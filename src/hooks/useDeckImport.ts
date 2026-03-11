import { useCallback } from 'react';
import { useAppContext } from '../state/AppContext';
import { parseMoxfieldDecklist } from '../services/decklistParser';
import { fetchAllCards } from '../services/scryfallApi';
import { detectTokens } from '../services/tokenDetector';
import { detectSupport } from '../services/supportDetector';
import { detectTriggerType } from '../services/triggerDetector';
import type { CardCategory, ScryfallTokenData, TokenDefinition } from '../types';

const KEYWORDS = [
  'flying', 'haste', 'trample', 'vigilance', 'lifelink', 'deathtouch',
  'first strike', 'double strike', 'menace', 'reach', 'hexproof',
  'indestructible', 'defender',
];

/** Build a TokenDefinition from Scryfall token data (for companion cards like Chatterfang) */
function tokenDefFromData(data: ScryfallTokenData): TokenDefinition {
  const types: string[] = [];
  const typeLine = data.type_line.toLowerCase();
  if (typeLine.includes('creature')) types.push('creature');
  if (typeLine.includes('artifact')) types.push('artifact');
  if (typeLine.includes('enchantment')) types.push('enchantment');

  return {
    count: 1,
    power: data.power || '',
    toughness: data.toughness || '',
    colors: data.colors,
    name: data.name,
    types: types.length > 0 ? types : ['creature'],
    keywords: data.keywords.filter(k => KEYWORDS.includes(k.toLowerCase())).map(k => k.toLowerCase()),
    rawText: `${data.power || ''}/${data.toughness || ''} ${data.colors.join(' ')} ${data.name}`.trim(),
  };
}

export function useDeckImport() {
  const { dispatch } = useAppContext();

  const importDeck = useCallback(async (rawText: string) => {
    dispatch({ type: 'SET_RAW_DECKLIST', payload: rawText });

    const entries = parseMoxfieldDecklist(rawText);
    if (entries.length === 0) {
      dispatch({ type: 'IMPORT_ERROR', payload: 'No cards found in decklist. Check the format.' });
      return;
    }

    const uniqueNames = [...new Set(entries.map(e => e.name))];
    dispatch({ type: 'IMPORT_START', payload: { total: uniqueNames.length } });

    try {
      const cardDataMap = await fetchAllCards(uniqueNames, (done, total) => {
        dispatch({ type: 'FETCH_PROGRESS', payload: { done, total } });
      });

      const deckCards = entries
        .filter(entry => cardDataMap.has(entry.name))
        .map(entry => {
          const { card: scryfallData, tokenArt, tokenData } = cardDataMap.get(entry.name)!;
          const tokens = detectTokens(scryfallData, tokenData);
          const supportEffects = detectSupport(scryfallData);
          const oracleText = scryfallData.oracle_text || scryfallData.card_faces?.map(f => f.oracle_text || '').join('\n') || '';
          const hasPopulate = /\bpopulate\b/i.test(oracleText);

          // Companion cards like Chatterfang create their own token type but
          // detectTokens skips them (isReplacementEffect). Populate from Scryfall
          // token data so the reducer knows what companion token to create.
          const hasCompanion = supportEffects.some(e => e.type === 'companion');
          const isManufactorStyle = hasCompanion
            && /instead\s+create\s+one\s+of\s+each/i.test(oracleText);
          if (hasCompanion && !isManufactorStyle && tokens.length === 0 && tokenData.length > 0) {
            tokens.push(tokenDefFromData(tokenData[0]));
          }

          const isGenerator = tokens.length > 0 || hasPopulate;
          const triggerInfo = isGenerator ? detectTriggerType(scryfallData) ?? undefined : undefined;

          let category: CardCategory = 'other';
          if (isGenerator && supportEffects.length > 0) {
            category = 'both';
          } else if (isGenerator) {
            category = 'token-generator';
          } else if (supportEffects.length > 0) {
            category = 'support';
          }

          return {
            decklistEntry: entry,
            scryfallData,
            category,
            tokens,
            supportEffects,
            tokenArt,
            triggerInfo,
            hasPopulate,
          };
        })
        .filter(card => card.category !== 'other');

      dispatch({ type: 'IMPORT_COMPLETE', payload: deckCards });
    } catch (err) {
      dispatch({
        type: 'IMPORT_ERROR',
        payload: err instanceof Error ? err.message : 'Failed to import deck',
      });
    }
  }, [dispatch]);

  return { importDeck };
}
