import { useMemo, useState } from 'react';
import { useAppContext } from '../state/AppContext';
import { CardRow } from './CardRow';
import { XValueModal } from './XValueModal';
import type { DeckCard } from '../types';

const TYPE_ORDER = ['creature', 'enchantment', 'artifact', 'planeswalker', 'instant', 'sorcery', 'land'];
const TYPE_LABELS: Record<string, string> = {
  creature: 'Creatures',
  enchantment: 'Enchantments',
  artifact: 'Artifacts',
  planeswalker: 'Planeswalkers',
  instant: 'Instants',
  sorcery: 'Sorceries',
  land: 'Lands',
  other: 'Other',
};

function getCardTypeGroup(card: DeckCard): string {
  const typeLine = card.scryfallData.type_line.toLowerCase();
  // Check in priority order — a "Creature" that's also an "Artifact" goes under Creatures
  for (const t of TYPE_ORDER) {
    if (typeLine.includes(t)) return t;
  }
  return 'other';
}

interface TypeGroup {
  type: string;
  label: string;
  cards: Array<{ card: DeckCard; index: number }>;
}

function groupByType(cards: Array<{ card: DeckCard; index: number }>): TypeGroup[] {
  const groups = new Map<string, Array<{ card: DeckCard; index: number }>>();
  for (const entry of cards) {
    const type = getCardTypeGroup(entry.card);
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(entry);
  }
  const result: TypeGroup[] = [];
  for (const type of [...TYPE_ORDER, 'other']) {
    const items = groups.get(type);
    if (items && items.length > 0) {
      result.push({ type, label: TYPE_LABELS[type] ?? type, cards: items });
    }
  }
  return result;
}

export function DeckList() {
  const { state, dispatch } = useAppContext();
  const { deckCards, battlefield } = state;
  const [xModalIndex, setXModalIndex] = useState<number | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const generators = useMemo(() =>
    deckCards
      .map((c, i) => ({ card: c, index: i }))
      .filter(({ card }) => card.category === 'token-generator' || card.category === 'both'),
    [deckCards]
  );

  const support = useMemo(() =>
    deckCards
      .map((c, i) => ({ card: c, index: i }))
      .filter(({ card }) => card.category === 'support'),
    [deckCards]
  );

  const generatorGroups = useMemo(() => groupByType(generators), [generators]);
  const supportGroups = useMemo(() => groupByType(support), [support]);

  if (state.importStatus !== 'done' || deckCards.length === 0) return null;

  const getInPlayCount = (index: number) =>
    battlefield.filter(b => b.deckCardIndex === index).length;

  const needsXOnPlay = (index: number) => {
    const card = deckCards[index];
    if (card.tokens.some(t => t.countMode === 'self-copies')) return false;
    if (!card.tokens.some(t => t.count === -1)) return false;
    const type = card.scryfallData.type_line.toLowerCase();
    const isInstantSorcery = type.includes('instant') || type.includes('sorcery');
    return isInstantSorcery || card.triggerInfo?.type === 'etb' || card.triggerInfo?.alsoEtb || !card.triggerInfo;
  };

  const handlePlay = (deckCardIndex: number) => {
    if (needsXOnPlay(deckCardIndex)) {
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

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderCardRow = (card: DeckCard, index: number) => {
    return (
      <CardRow
        key={index}
        card={card}
        inPlayCount={getInPlayCount(index)}
        onPlay={() => handlePlay(index)}
        showPlayButton
        compact
      />
    );
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
          {!collapsedSections.generators && generatorGroups.map(group => (
            <div key={group.type} className="type-subgroup">
              <h4 className="type-subgroup-label">{group.label} ({group.cards.length})</h4>
              {group.cards.map(({ card, index }) => renderCardRow(card, index))}
            </div>
          ))}
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
          {!collapsedSections.support && supportGroups.map(group => (
            <div key={group.type} className="type-subgroup">
              <h4 className="type-subgroup-label">{group.label} ({group.cards.length})</h4>
              {group.cards.map(({ card, index }) => renderCardRow(card, index))}
            </div>
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
