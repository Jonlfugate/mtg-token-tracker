import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../state/AppContext';
import { CardRow } from './CardRow';
import { XValueModal } from './XValueModal';
import type { StandaloneToken, TokenDefinition } from '../types';
import { COLOR_BORDER_MAP, TRIGGER_GROUP_ORDER, TRIGGER_GROUP_LABELS } from '../constants';

function getTokenBorderColor(tokenDef: TokenDefinition): string {
  const colors = tokenDef.colors.filter(c => c !== 'colorless');
  if (colors.length === 0) return '#6b7280';
  if (colors.length > 1) return '#c9a92c';
  return COLOR_BORDER_MAP[colors[0]] ?? '#6b7280';
}

export function Battlefield() {
  const { state, dispatch } = useAppContext();
  const { deckCards, battlefield, standaloneTokens } = state;
  const [triggerXModal, setTriggerXModal] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const prevTokenCountsRef = useRef<Map<string, number>>(new Map());
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const populateMode = state.pendingPopulate > 0 && standaloneTokens.length > 0;

  // Group battlefield cards by trigger type
  const triggerGroups = useMemo(() => {
    const groups = new Map<string, Array<{ deckIdx: number; instanceIds: string[] }>>();

    const cardMap = new Map<number, string[]>();
    for (const bc of battlefield) {
      if (!cardMap.has(bc.deckCardIndex)) {
        cardMap.set(bc.deckCardIndex, []);
      }
      cardMap.get(bc.deckCardIndex)!.push(bc.instanceId);
    }

    for (const [deckIdx, instanceIds] of cardMap) {
      const card = deckCards[deckIdx];
      let groupKey: string;
      if (card.category === 'support') {
        groupKey = 'support';
      } else if (card.triggerInfo) {
        groupKey = card.triggerInfo.type;
      } else {
        groupKey = 'none';
      }
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push({ deckIdx, instanceIds });
    }

    // Sort groups in defined order
    const ordered: Array<{ key: string; label: string; cards: Array<{ deckIdx: number; instanceIds: string[] }> }> = [];
    for (const key of [...TRIGGER_GROUP_ORDER, 'support', 'none']) {
      const cards = groups.get(key);
      if (cards && cards.length > 0) {
        ordered.push({ key, label: TRIGGER_GROUP_LABELS[key] ?? key, cards });
      }
    }
    return ordered;
  }, [battlefield, deckCards]);

  // Check if we have any landfall generators on the battlefield
  const hasLandfall = battlefield.some(bc => {
    const card = deckCards[bc.deckCardIndex];
    return (card.category === 'token-generator' || card.category === 'both')
      && card.triggerInfo?.type === 'landfall';
  });

  const handleLandPlayed = useCallback(() => {
    dispatch({ type: 'TRIGGER_ALL', payload: { triggerTypes: ['landfall'] } });
  }, [dispatch]);

  const handleNewTurn = useCallback(() => {
    dispatch({ type: 'NEW_TURN' });
    dispatch({ type: 'TRIGGER_ALL', payload: { triggerTypes: ['upkeep', 'combat'] } });
  }, [dispatch]);

  const handleRemoveCard = useCallback((instanceId: string) => {
    dispatch({ type: 'REMOVE_CARD', payload: { instanceId } });
  }, [dispatch]);

  const handleRemoveToken = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_STANDALONE_TOKEN', payload: { id } });
  }, [dispatch]);

  const handleTrigger = useCallback((deckCardIndex: number) => {
    const card = deckCards[deckCardIndex];
    const hasVariable = card.tokens.some(t => t.count === -1);
    if (card.tokens.length > 0) {
      if (hasVariable) {
        setTriggerXModal(deckCardIndex);
      } else {
        dispatch({ type: 'TRIGGER_CARD', payload: { deckCardIndex } });
      }
    } else if (card.hasPopulate) {
      dispatch({ type: 'TRIGGER_CARD', payload: { deckCardIndex } });
    }
  }, [deckCards, dispatch]);

  // Process pendingXTriggers queue — show modal for the first queued card
  const pendingXIndex = state.pendingXTriggers.length > 0 ? state.pendingXTriggers[0] : null;
  const showXModal = triggerXModal ?? pendingXIndex;

  const handleTriggerXConfirm = useCallback((xValue: number) => {
    if (triggerXModal !== null) {
      dispatch({ type: 'TRIGGER_CARD', payload: { deckCardIndex: triggerXModal, xValue } });
      setTriggerXModal(null);
    } else if (pendingXIndex !== null) {
      dispatch({ type: 'TRIGGER_CARD', payload: { deckCardIndex: pendingXIndex, xValue } });
      dispatch({ type: 'SHIFT_X_TRIGGER' });
    }
  }, [triggerXModal, pendingXIndex, dispatch]);

  const handleXModalCancel = useCallback(() => {
    if (triggerXModal !== null) {
      setTriggerXModal(null);
    } else if (pendingXIndex !== null) {
      dispatch({ type: 'SHIFT_X_TRIGGER' });
    }
  }, [triggerXModal, pendingXIndex, dispatch]);

  const handlePopulateSelect = useCallback((token: StandaloneToken) => {
    dispatch({ type: 'ADJUST_TOKEN', payload: { id: token.id, delta: 1 } });
    dispatch({ type: 'RESOLVE_POPULATE' });
  }, [dispatch]);

  const handlePopulateCancel = useCallback(() => {
    dispatch({ type: 'CANCEL_POPULATE' });
  }, [dispatch]);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, [dispatch]);

  const handleClearAllTokens = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL_TOKENS' });
  }, [dispatch]);

  const handleClearTurnTokens = useCallback(() => {
    dispatch({ type: 'CLEAR_TURN_TOKENS' });
  }, [dispatch]);

  // Count total creatures on battlefield (cards + creature tokens)
  const creatureCount = useMemo(() => {
    let count = 0;
    // Count creature cards on battlefield
    for (const bc of battlefield) {
      const card = deckCards[bc.deckCardIndex];
      if (card.scryfallData.type_line.toLowerCase().includes('creature')) count++;
    }
    // Count creature tokens
    for (const token of standaloneTokens) {
      if (token.tokenDef.types.includes('creature')) count += token.finalCount;
    }
    return count;
  }, [battlefield, deckCards, standaloneTokens]);

  const totalTokens = useMemo(
    () => standaloneTokens.reduce((sum, t) => sum + t.finalCount, 0),
    [standaloneTokens]
  );

  const groupedTokens = useMemo(() => {
    const currentTurn = state.currentTurn;
    const grouped = new Map<string, { ids: string[]; totalCount: number; thisTurnCount: number; sources: Set<string>; breakdowns: string[]; token: typeof standaloneTokens[0] }>();
    for (const token of standaloneTokens) {
      // Group by token identity only (name + P/T), not by source — merges all Treasures, etc.
      const key = `${token.tokenDef.name}|${token.tokenDef.power ?? ''}|${token.tokenDef.toughness ?? ''}`;
      const existing = grouped.get(key);
      const isThisTurn = token.createdOnTurn === currentTurn;
      if (existing) {
        existing.ids.push(token.id);
        existing.totalCount += token.finalCount;
        existing.sources.add(token.sourceName);
        if (!existing.breakdowns.includes(token.breakdown)) existing.breakdowns.push(token.breakdown);
        if (isThisTurn) existing.thisTurnCount += token.finalCount;
      } else {
        grouped.set(key, { ids: [token.id], totalCount: token.finalCount, thisTurnCount: isThisTurn ? token.finalCount : 0, sources: new Set([token.sourceName]), breakdowns: [token.breakdown], token });
      }
    }

    return Array.from(grouped.values());
  }, [standaloneTokens, state.currentTurn]);

  // Animation detection — separated from useMemo to avoid side effects in pure computation
  useEffect(() => {
    const newCounts = new Map<string, number>();
    const toAnimate = new Set<string>();
    for (const g of groupedTokens) {
      const key = g.ids[0];
      newCounts.set(key, g.totalCount);
      const prev = prevTokenCountsRef.current.get(key);
      if (prev !== undefined && prev !== g.totalCount) {
        toAnimate.add(key);
      }
    }
    prevTokenCountsRef.current = newCounts;

    if (toAnimate.size > 0) {
      setAnimatingIds(toAnimate);
      const timer = setTimeout(() => setAnimatingIds(new Set()), 500);
      return () => clearTimeout(timer);
    }
  }, [groupedTokens]);

  if (state.importStatus !== 'done') return null;

  if (battlefield.length === 0 && standaloneTokens.length === 0) {
    return (
      <div className="battlefield-panel">
        <div className="battlefield-header">
          <h2>Battlefield</h2>
        </div>
        <p className="empty-state">Play cards from your decklist to see them here.</p>
      </div>
    );
  }

  return (
    <div className="battlefield-panel">
      <div className="battlefield-header">
        <h2>
          Battlefield <span className="turn-badge">Turn {state.currentTurn}</span>
          {creatureCount > 0 && <span className="creature-count">{creatureCount} creatures</span>}
        </h2>
        <div className="battlefield-actions">
          {state.undoStack.length > 0 && (
            <button className="undo-btn" onClick={handleUndo} title="Undo last action">
              Undo
            </button>
          )}
          <button
            className="land-played-btn"
            onClick={handleLandPlayed}
            disabled={!hasLandfall}
            title="Trigger all landfall abilities"
          >
            Land Played
          </button>
          <button
            className="new-turn-btn"
            onClick={handleNewTurn}
            title="Advance turn and trigger all upkeep/combat abilities"
          >
            New Turn
          </button>
          <button
            className="history-btn secondary"
            onClick={() => setShowHistory(!showHistory)}
            title="Toggle turn history"
          >
            {showHistory ? 'Hide Log' : 'Log'}
          </button>
        </div>
      </div>

      {/* Populate mode banner */}
      {populateMode && (
        <div className="populate-banner">
          <span>Select a token to populate ({state.pendingPopulate} remaining)</span>
          <button className="secondary" onClick={handlePopulateCancel}>Cancel</button>
        </div>
      )}

      {/* Turn history log */}
      {showHistory && (
        <div className="history-log">
          <h4>Turn History</h4>
          {state.history.length === 0 ? (
            <p className="empty-state">No actions yet.</p>
          ) : (
            <ul>
              {[...state.history].reverse().map((entry, i) => (
                <li key={i} className="history-entry">
                  <span className="history-turn">T{entry.turn}</span>
                  <span className="history-label">{entry.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Permanent cards in play — grouped by trigger type */}
      {triggerGroups.length > 0 && (
        <div className={`battlefield-cards${populateMode ? ' populate-dimmed' : ''}`}>
          <h3>Cards in Play</h3>
          {triggerGroups.map(group => (
            <div key={group.key} className="trigger-group">
              <h4 className={`trigger-group-label trigger-group-${group.key}`}>{group.label}</h4>
              {group.cards.map(({ deckIdx, instanceIds }) => {
                const card = deckCards[deckIdx];
                const isGenerator = card.category === 'token-generator' || card.category === 'both';
                const triggerLabel = card.triggerInfo?.label;
                const conditionalTokens = card.tokens.filter(t => t.isConditional);

                return instanceIds.map(instanceId => {
                  const bc = battlefield.find(b => b.instanceId === instanceId);
                  const conditionsMet = bc?.conditionsMet ?? {};
                  const conditions = conditionalTokens.map(t => ({
                    tokenName: t.name,
                    label: t.condition || t.name,
                    checked: conditionsMet[t.name] ?? false,
                  }));

                  return (
                    <CardRow
                      key={instanceId}
                      card={card}
                      inPlayCount={instanceIds.length}
                      onRemove={() => handleRemoveCard(instanceId)}
                      showRemoveButton
                      onTrigger={isGenerator ? () => handleTrigger(deckIdx) : undefined}
                      triggerLabel={triggerLabel}
                      conditions={conditions}
                      onToggleCondition={(tokenName) => dispatch({ type: 'TOGGLE_CONDITION', payload: { instanceId, tokenName } })}
                      compact
                    />
                  );
                });
              })}
            </div>
          ))}
        </div>
      )}

      {/* All tokens — merged identical tokens */}
      {groupedTokens.length > 0 && (
        <div className="token-battlefield">
          <div className="token-header">
            <h3>Tokens ({totalTokens})</h3>
            <div className="token-bulk-actions">
              {standaloneTokens.some(t => t.createdOnTurn === state.currentTurn) && (
                <button className="bulk-clear-btn secondary" onClick={handleClearTurnTokens} title="Remove tokens created this turn">
                  Clear This Turn
                </button>
              )}
              <button className="bulk-clear-btn danger" onClick={handleClearAllTokens} title="Remove all tokens (board wipe)">
                Clear All
              </button>
            </div>
          </div>
          <div className="token-grid">
            {groupedTokens.map(({ ids, totalCount, thisTurnCount, sources, breakdowns, token }) => {
              const copySource = token.copyOfDeckIndex !== undefined
                ? deckCards[token.copyOfDeckIndex]
                : undefined;
              const copyArtUrl = copySource?.scryfallData.image_uris?.art_crop
                || copySource?.scryfallData.card_faces?.[0]?.image_uris?.art_crop;
              const artUrl = token.tokenArt?.imageUrl || copyArtUrl;
              const artAlt = token.tokenArt?.name || copySource?.scryfallData.name || token.tokenDef.name;
              const hasPT = token.tokenDef.power && token.tokenDef.toughness;
              const keywords = token.tokenDef.keywords?.filter(k => k) ?? [];
              const isAnimating = animatingIds.has(ids[0]);
              const breakdownText = breakdowns.join('\n');
              const borderColor = getTokenBorderColor(token.tokenDef);

              return (
              <div
                key={ids[0]}
                className={`token-tile${populateMode ? ' populate-selectable' : ''}${isAnimating ? ' token-animate' : ''}`}
                style={{ borderColor }}
                onClick={populateMode ? () => handlePopulateSelect(token) : undefined}
                role={populateMode ? 'button' : undefined}
                tabIndex={populateMode ? 0 : undefined}
                onKeyDown={populateMode ? (e) => { if (e.key === 'Enter') handlePopulateSelect(token); } : undefined}
                title={breakdownText}
              >
                {!populateMode && (
                <button
                  className="token-remove-btn"
                  onClick={() => ids.forEach(id => handleRemoveToken(id))}
                  title="Remove all"
                  aria-label={`Remove all ${token.tokenDef.name} tokens`}
                >
                  &times;
                </button>
                )}
                {artUrl ? (
                  <div className="token-art-wrapper">
                    <img
                      src={artUrl}
                      alt={`${artAlt} token`}
                      className="token-art"
                      loading="lazy"
                    />
                    <div className="token-count-overlay">
                      <span className="token-count-number">{totalCount}</span>
                    </div>
                    {hasPT && (
                      <div className="token-pt-badge">
                        {token.tokenDef.power}/{token.tokenDef.toughness}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="token-art-placeholder">
                    <span className="token-count-number">{totalCount}</span>
                    {hasPT && (
                      <div className="token-pt-badge-placeholder">
                        {token.tokenDef.power}/{token.tokenDef.toughness}
                      </div>
                    )}
                  </div>
                )}
                <div className="token-tile-info">
                  <span className="token-tile-name">
                    {token.tokenDef.name}
                  </span>
                  {keywords.length > 0 && (
                    <span className="token-keywords">
                      {keywords.join(', ')}
                    </span>
                  )}
                  <span className="token-tile-source" title={Array.from(sources).join(', ')}>
                    from {sources.size === 1 ? Array.from(sources)[0] : `${sources.size} sources`}
                  </span>
                  {thisTurnCount > 0 && thisTurnCount < totalCount && (
                    <span className="token-tile-turn-info">+{thisTurnCount} this turn</span>
                  )}
                  <div className="token-adjust-btns">
                    <button
                      className="token-adjust-btn"
                      onClick={() => dispatch({ type: 'ADJUST_TOKEN', payload: { id: ids[0], delta: -1 } })}
                      title="Remove one"
                      aria-label={`Remove one ${token.tokenDef.name} token`}
                    >
                      &minus;
                    </button>
                    <button
                      className="token-adjust-btn"
                      onClick={() => dispatch({ type: 'ADJUST_TOKEN', payload: { id: ids[0], delta: 1 } })}
                      title="Add one"
                      aria-label={`Add one ${token.tokenDef.name} token`}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {showXModal !== null && (
        <XValueModal
          cardName={deckCards[showXModal].scryfallData.name}
          onConfirm={handleTriggerXConfirm}
          onCancel={handleXModalCancel}
        />
      )}
    </div>
  );
}
