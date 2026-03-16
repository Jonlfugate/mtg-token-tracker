import { useCallback, useState } from 'react';
import { useAppContext } from '../state/AppContext';
import { fetchAllCards } from '../services/scryfallApi';
import { detectTokens } from '../services/tokenDetector';
import { detectSupport } from '../services/supportDetector';
import { detectTriggerType } from '../services/triggerDetector';
import type { CardCategory } from '../types';

export function useAddCard() {
  const { dispatch } = useAppContext();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const addCard = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setAdding(true);
    setAddError(null);

    try {
      const result = await fetchAllCards([name.trim()], () => {});
      const entry = result.get(name.trim()) || result.get([...result.keys()][0]);
      if (!entry) {
        setAddError(`Card "${name}" not found.`);
        return;
      }

      const { card: scryfallData, tokenArt, tokenData } = entry;
      const tokens = detectTokens(scryfallData, tokenData);
      const supportEffects = detectSupport(scryfallData);
      const oracleText = scryfallData.oracle_text || scryfallData.card_faces?.map(f => f.oracle_text || '').join('\n') || '';
      const hasPopulate = /\bpopulate\b/i.test(oracleText);
      const isGenerator = tokens.length > 0 || hasPopulate;
      const triggerInfo = isGenerator ? detectTriggerType(scryfallData) ?? undefined : undefined;

      let category: CardCategory = 'other';
      if (isGenerator && supportEffects.length > 0) category = 'both';
      else if (isGenerator) category = 'token-generator';
      else if (supportEffects.length > 0) category = 'support';

      if (category === 'other') {
        setAddError(`"${scryfallData.name}" doesn't produce tokens or have support effects.`);
        return;
      }

      dispatch({
        type: 'ADD_CARD',
        payload: {
          decklistEntry: { quantity: 1, name: scryfallData.name },
          scryfallData,
          category,
          tokens,
          supportEffects,
          tokenArt,
          triggerInfo,
          hasPopulate,
        },
      });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to fetch card.');
    } finally {
      setAdding(false);
    }
  }, [dispatch]);

  return { addCard, adding, addError };
}
