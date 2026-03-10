import { useState } from 'react';
import { useAppContext } from '../state/AppContext';
import { CardRow } from './CardRow';
import { XValueModal } from './XValueModal';

export function DeckList() {
  const { state, dispatch } = useAppContext();
  const { deckCards, battlefield } = state;
  const [xModalIndex, setXModalIndex] = useState<number | null>(null);
  const [playQuantities, setPlayQuantities] = useState<Record<number, number>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  if (state.importStatus !== 'done' || deckCards.length === 0) return null;

  const generators = deckCards
    .map((c, i) => ({ card: c, index: i }))
    .filter(({ card }) => card.category === 'token-generator' || card.category === 'both');

  const support = deckCards
    .map((c, i) => ({ card: c, index: i }))
    .filter(({ card }) => card.category === 'support');

  const getInPlayCount = (index: number) =>
    battlefield.filter(b => b.deckCardIndex === index).length;

  const hasSelfCopies = (index: number) =>
    deckCards[index].tokens.some(t => t.countMode === 'self-copies');

  const getRemaining = (index: number) =>
    deckCards[index].decklistEntry.quantity - getInPlayCount(index);

  const needsXOnPlay = (index: number) => {
    const card = deckCards[index];
    // Self-copies cards auto-calculate, no X prompt needed
    if (card.tokens.some(t => t.countMode === 'self-copies')) return false;
    if (!card.tokens.some(t => t.count === -1)) return false;
    const type = card.scryfallData.type_line.toLowerCase();
    const isInstantSorcery = type.includes('instant') || type.includes('sorcery');
    return isInstantSorcery || card.triggerInfo?.type === 'etb' || card.triggerInfo?.alsoEtb || !card.triggerInfo;
  };

  const handlePlay = (deckCardIndex: number) => {
    const quantity = playQuantities[deckCardIndex] || 1;
    if (needsXOnPlay(deckCardIndex)) {
      setXModalIndex(deckCardIndex);
    } else {
      dispatch({ type: 'PLAY_CARD', payload: { deckCardIndex, quantity } });
      setPlayQuantities(prev => ({ ...prev, [deckCardIndex]: 1 }));
    }
  };

  const handleXConfirm = (xValue: number) => {
    if (xModalIndex !== null) {
      dispatch({ type: 'PLAY_CARD', payload: { deckCardIndex: xModalIndex, xValue } });
      setXModalIndex(null);
    }
  };

  const handleQuantityChange = (index: number, value: number) => {
    const remaining = getRemaining(index);
    const clamped = Math.max(1, Math.min(value, remaining));
    setPlayQuantities(prev => ({ ...prev, [index]: clamped }));
  };

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="deck-list">
      <h2>Decklist ({deckCards.length} cards)</h2>

      {generators.length > 0 && (
        <div className="deck-section">
          <h3
            className="deck-section-header"
            onClick={() => toggleSection('generators')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') toggleSection('generators'); }}
          >
            <span className={`collapse-arrow${collapsedSections.generators ? ' collapsed' : ''}`}>&#9662;</span>
            Token Generators ({generators.length})
          </h3>
          {!collapsedSections.generators && generators.map(({ card, index }) => {
            const remaining = getRemaining(index);
            const showQuantity = hasSelfCopies(index) && remaining > 1;
            const qty = playQuantities[index] || 1;

            return (
              <CardRow
                key={index}
                card={card}
                inPlayCount={getInPlayCount(index)}
                onPlay={() => handlePlay(index)}
                showPlayButton
                extraLabel={showQuantity ? undefined : undefined}
              >
                {showQuantity && (
                  <div className="play-quantity">
                    <label>
                      Play
                      <input
                        type="number"
                        min={1}
                        max={remaining}
                        value={qty}
                        onChange={(e) => handleQuantityChange(index, parseInt(e.target.value, 10) || 1)}
                        className="quantity-input"
                      />
                      at once
                    </label>
                  </div>
                )}
              </CardRow>
            );
          })}
        </div>
      )}

      {support.length > 0 && (
        <div className="deck-section">
          <h3
            className="deck-section-header"
            onClick={() => toggleSection('support')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') toggleSection('support'); }}
          >
            <span className={`collapse-arrow${collapsedSections.support ? ' collapsed' : ''}`}>&#9662;</span>
            Support / Multipliers ({support.length})
          </h3>
          {!collapsedSections.support && support.map(({ card, index }) => (
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
