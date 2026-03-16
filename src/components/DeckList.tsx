import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../state/AppContext';
import { CardRow } from './CardRow';
import type { DeckCard } from '../types';
import { TRIGGER_GROUP_ORDER, TRIGGER_GROUP_LABELS, TRIGGER_COLORS } from '../constants';
import { useAddCard } from '../hooks/useAddCard';

const SECTION_ORDER = [...TRIGGER_GROUP_ORDER, 'support', 'none'];

function getTriggerKey(card: DeckCard): string {
  if (card.category === 'support' || card.category === 'both') return 'support';
  if (card.triggerInfo) return card.triggerInfo.type;
  return 'none';
}

function getSectionColor(key: string): string {
  if (key === 'support') return '#ff9800';
  if (key === 'none') return '#6b7280';
  return TRIGGER_COLORS[key] ?? TRIGGER_COLORS['other'];
}

export function DeckList() {
  const { state, dispatch } = useAppContext();
  const { deckCards, battlefield } = state;
  const [playValues, setPlayValues] = useState<Record<number, string>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(
    () => new Set(SECTION_ORDER)
  );
  const [showNonToken, setShowNonToken] = useState(false);

  const { addCard, adding, addError } = useAddCard();
  const [addCardName, setAddCardName] = useState('');

  const handleAddCard = () => {
    if (!addCardName.trim()) return;
    addCard(addCardName.trim()).then(() => setAddCardName(''));
  };

  // Group token-producing cards by trigger type, sorted alphabetically
  const triggerGroups = useMemo(() => {
    const groups = new Map<string, Array<{ card: DeckCard; index: number }>>();
    for (const key of SECTION_ORDER) groups.set(key, []);

    for (let i = 0; i < deckCards.length; i++) {
      const card = deckCards[i];
      if (card.category === 'other') continue; // handled separately
      const key = getTriggerKey(card);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ card, index: i });
    }

    for (const cards of groups.values()) {
      cards.sort((a, b) => a.card.scryfallData.name.localeCompare(b.card.scryfallData.name));
    }
    return groups;
  }, [deckCards]);

  const nonTokenCards = useMemo(() =>
    deckCards
      .map((c, i) => ({ card: c, index: i }))
      .filter(({ card }) => card.category === 'other')
      .sort((a, b) => a.card.scryfallData.name.localeCompare(b.card.scryfallData.name)),
    [deckCards]
  );

  const handleCopyTokenSummary = useCallback(() => {
    const lines: string[] = ['Token Summary', '=============', ''];
    for (const key of SECTION_ORDER) {
      const cards = triggerGroups.get(key) ?? [];
      if (cards.length === 0) continue;
      const label = TRIGGER_GROUP_LABELS[key] ?? key;
      lines.push(`[${label}]`);
      for (const { card } of cards) {
        const tokens = card.tokens.filter(t => t.countMode !== 'double-tokens' && t.countMode !== 'copy-turn-tokens');
        if (tokens.length === 0) continue;
        const tokenStr = tokens.map(t => {
          const qty = t.count === -1 ? 'X' : `${t.count}`;
          const pt = t.power ? ` ${t.power}/${t.toughness}` : '';
          const cond = t.condition ? ` (if ${t.condition})` : '';
          return `${qty}×${pt} ${t.name}${cond}`;
        }).join(', ');
        lines.push(`  ${card.scryfallData.name}: ${tokenStr}`);
      }
      lines.push('');
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
  }, [triggerGroups]);

  // Precompute in-play counts once per battlefield change instead of filtering per-card per-render
  const inPlayCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const bc of battlefield) {
      map.set(bc.deckCardIndex, (map.get(bc.deckCardIndex) ?? 0) + 1);
    }
    return map;
  }, [battlefield]);

  // Ref so handlePlay always reads the latest playValues without capturing it as a dep,
  // keeping the callback reference stable across renders that only change playValues.
  const playValuesRef = useRef(playValues);
  playValuesRef.current = playValues;

  const needsXOnPlay = useCallback((index: number) => {
    const card = deckCards[index];
    if (card.tokens.some(t => t.countMode === 'self-copies')) return false;
    if (card.tokens.some(t => t.countMode === 'counters')) return false;
    if (!card.tokens.some(t => t.count === -1)) return false;
    const type = card.scryfallData.type_line.toLowerCase();
    const isInstantSorcery = type.includes('instant') || type.includes('sorcery');
    return isInstantSorcery || card.triggerInfo?.type === 'etb' || card.triggerInfo?.alsoEtb || !card.triggerInfo;
  }, [deckCards]);

  const needsCounters = useCallback((index: number) =>
    deckCards[index].tokens.some(t => t.countMode === 'counters'),
  [deckCards]);

  const handlePlay = useCallback((deckCardIndex: number) => {
    const raw = playValuesRef.current[deckCardIndex];
    const needsC = deckCards[deckCardIndex].tokens.some(t => t.countMode === 'counters');
    const value = (raw === undefined || raw === '') ? (needsC ? 0 : 1) : (parseInt(raw, 10) || (needsC ? 0 : 1));
    if (needsXOnPlay(deckCardIndex)) {
      dispatch({ type: 'PLAY_CARD', payload: { deckCardIndex, xValue: value } });
    } else if (needsC) {
      dispatch({ type: 'PLAY_CARD', payload: { deckCardIndex, counters: value } });
    } else {
      dispatch({ type: 'PLAY_CARD', payload: { deckCardIndex, quantity: value } });
    }
  }, [dispatch, deckCards, needsXOnPlay]);

  const handlePlayValueChange = useCallback((index: number, value: string) => {
    setPlayValues(prev => ({ ...prev, [index]: value }));
  }, []);

  const toggleSection = useCallback((key: string) =>
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] })),
  []);

  const toggleVisible = useCallback((key: string) =>
    setVisibleGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    }),
  []);

  if (state.importStatus !== 'done' || deckCards.length === 0) return null;

  const getInputLabel = (card: DeckCard, index: number): string => {
    if (needsCounters(index)) return 'Counters';
    if (card.tokens.some(t => t.count === -1)) return 'X';
    return 'Qty';
  };

  const renderCardRow = (card: DeckCard, index: number) => {
    const inputLabel = getInputLabel(card, index);
    return (
      <CardRow
        key={index}
        card={card}
        inPlayCount={inPlayCounts.get(index) ?? 0}
        onPlay={() => handlePlay(index)}
        showPlayButton
        compact
      >
        <input
          type="number"
          className="play-value-input"
          min={needsCounters(index) ? 0 : 1}
          placeholder={inputLabel}
          value={playValues[index] ?? ''}
          onChange={(e) => handlePlayValueChange(index, e.target.value)}
          title={inputLabel}
          aria-label={inputLabel}
        />
      </CardRow>
    );
  };

  const totalCards = deckCards.length;

  return (
    <div className="deck-list">
      <h2>Decklist ({totalCards} cards)</h2>

      {/* Filter chips */}
      <div className="deck-filters">
        {SECTION_ORDER.map(key => {
          const cards = triggerGroups.get(key) ?? [];
          if (cards.length === 0) return null;
          const label = TRIGGER_GROUP_LABELS[key] ?? key;
          const color = getSectionColor(key);
          const on = visibleGroups.has(key);
          return (
            <button
              key={key}
              className={`deck-filter-chip${on ? ' on' : ''}`}
              style={{ '--chip-color': color } as React.CSSProperties}
              onClick={() => toggleVisible(key)}
              title={`${on ? 'Hide' : 'Show'} ${label}`}
            >
              {label} ({cards.length})
            </button>
          );
        })}
        {nonTokenCards.length > 0 && (
          <button
            className={`deck-filter-chip deck-filter-chip-neutral${showNonToken ? ' on' : ''}`}
            onClick={() => setShowNonToken(p => !p)}
            title={`${showNonToken ? 'Hide' : 'Show'} non-token cards`}
          >
            Non-token ({nonTokenCards.length})
          </button>
        )}
        <button
          className="deck-filter-chip deck-filter-chip-neutral on"
          onClick={handleCopyTokenSummary}
          title="Copy token summary to clipboard"
        >
          Copy Summary
        </button>
      </div>

      {/* Token-producing sections grouped by trigger */}
      {SECTION_ORDER.map(key => {
        if (!visibleGroups.has(key)) return null;
        const cards = triggerGroups.get(key) ?? [];
        if (cards.length === 0) return null;
        const label = TRIGGER_GROUP_LABELS[key] ?? key;
        const color = getSectionColor(key);
        const isCollapsed = collapsedSections[key] ?? false;

        return (
          <div
            key={key}
            className="deck-section"
            data-tutorial-target={
              key === 'upkeep' ? 'deck-section-upkeep' :
              key === 'landfall' ? 'deck-section-landfall' :
              key === 'support' ? 'deck-section-support' :
              undefined
            }
          >
            <h3
              className="deck-section-header"
              style={{ '--section-color': color } as React.CSSProperties}
              onClick={() => toggleSection(key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') toggleSection(key); }}
            >
              <span className={`collapse-arrow${isCollapsed ? ' collapsed' : ''}`}>&#9662;</span>
              {label} ({cards.length})
            </h3>
            {!isCollapsed && cards.map(({ card, index }) => renderCardRow(card, index))}
          </div>
        );
      })}

      {/* Non-token-producing cards */}
      {showNonToken && nonTokenCards.length > 0 && (
        <div className="deck-section">
          <h3
            className="deck-section-header"
            style={{ '--section-color': '#6b7280' } as React.CSSProperties}
            onClick={() => toggleSection('non-token')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') toggleSection('non-token'); }}
          >
            <span className={`collapse-arrow${collapsedSections['non-token'] ? ' collapsed' : ''}`}>&#9662;</span>
            Non-token ({nonTokenCards.length})
          </h3>
          {!collapsedSections['non-token'] && nonTokenCards.map(({ card, index }) => renderCardRow(card, index))}
        </div>
      )}

      {/* Manual card add */}
      <div className="add-card-row">
        <input
          type="text"
          className="add-card-input"
          placeholder="Add card by name..."
          value={addCardName}
          onChange={e => setAddCardName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAddCard(); }}
          disabled={adding}
        />
        <button
          className="add-card-btn"
          onClick={handleAddCard}
          disabled={adding || !addCardName.trim()}
        >
          {adding ? '...' : 'Add'}
        </button>
        {addError && <span className="add-card-error">{addError}</span>}
      </div>
    </div>
  );
}
