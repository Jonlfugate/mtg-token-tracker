import { useState } from 'react';
import { useAppContext } from '../state/AppContext';
import { CardRow } from './CardRow';
import { XValueModal } from './XValueModal';

export function DeckList() {
  const { state, dispatch } = useAppContext();
  const { deckCards, battlefield } = state;
  const [xModalIndex, setXModalIndex] = useState<number | null>(null);

  if (state.importStatus !== 'done' || deckCards.length === 0) return null;

  const generators = deckCards
    .map((c, i) => ({ card: c, index: i }))
    .filter(({ card }) => card.category === 'token-generator' || card.category === 'both');

  const support = deckCards
    .map((c, i) => ({ card: c, index: i }))
    .filter(({ card }) => card.category === 'support');

  const getInPlayCount = (index: number) =>
    battlefield.filter(b => b.deckCardIndex === index).length;

  const hasVariableTokens = (index: number) =>
    deckCards[index].tokens.some(t => t.count === -1);

  const handlePlay = (deckCardIndex: number) => {
    if (hasVariableTokens(deckCardIndex)) {
      setXModalIndex(deckCardIndex);
    } else {
      dispatch({ type: 'PLAY_CARD', payload: { deckCardIndex } });
    }
  };

  const handleXConfirm = (xValue: number) => {
    if (xModalIndex !== null) {
      dispatch({ type: 'PLAY_CARD', payload: { deckCardIndex: xModalIndex, xValue } });
      setXModalIndex(null);
    }
  };

  return (
    <div className="deck-list">
      <h2>Decklist ({deckCards.length} cards)</h2>

      {generators.length > 0 && (
        <div className="deck-section">
          <h3>Token Generators ({generators.length})</h3>
          {generators.map(({ card, index }) => (
            <CardRow
              key={index}
              card={card}
              inPlayCount={getInPlayCount(index)}
              onPlay={() => handlePlay(index)}
              showPlayButton
            />
          ))}
        </div>
      )}

      {support.length > 0 && (
        <div className="deck-section">
          <h3>Support / Multipliers ({support.length})</h3>
          {support.map(({ card, index }) => (
            <CardRow
              key={index}
              card={card}
              inPlayCount={getInPlayCount(index)}
              onPlay={() => handlePlay(index)}
              showPlayButton
            />
          ))}
        </div>
      )}

      {xModalIndex !== null && (
        <XValueModal
          cardName={deckCards[xModalIndex].scryfallData.name}
          onConfirm={handleXConfirm}
          onCancel={() => setXModalIndex(null)}
        />
      )}
    </div>
  );
}
