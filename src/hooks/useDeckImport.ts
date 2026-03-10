import { useCallback } from 'react';
import { useAppContext } from '../state/AppContext';
import { parseMoxfieldDecklist } from '../services/decklistParser';
import { fetchAllCards } from '../services/scryfallApi';
import { detectTokens } from '../services/tokenDetector';
import { detectSupport } from '../services/supportDetector';
import { detectTriggerType } from '../services/triggerDetector';
import type { CardCategory } from '../types';

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
          const { card: scryfallData, tokenArt } = cardDataMap.get(entry.name)!;
          const tokens = detectTokens(scryfallData);
          const supportEffect = detectSupport(scryfallData);
          const oracleText = scryfallData.oracle_text || scryfallData.card_faces?.map(f => f.oracle_text || '').join('\n') || '';
          const hasPopulate = /\bpopulate\b/i.test(oracleText);
          const isGenerator = tokens.length > 0 || hasPopulate;
          const triggerInfo = isGenerator ? detectTriggerType(scryfallData) ?? undefined : undefined;

          let category: CardCategory = 'other';
          if (isGenerator && supportEffect) {
            category = 'both';
          } else if (isGenerator) {
            category = 'token-generator';
          } else if (supportEffect) {
            category = 'support';
          }

          return {
            decklistEntry: entry,
            scryfallData,
            category,
            tokens,
            supportEffect,
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
