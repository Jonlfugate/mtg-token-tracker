import { useCallback, useMemo, useState } from 'react';
import { useAppContext } from '../state/AppContext';
import { CardRow } from './CardRow';
import { XValueModal } from './XValueModal';
import type { StandaloneToken } from '../types';

export function Battlefield() {
  const { state, dispatch } = useAppContext();
  const { deckCards, battlefield, standaloneTokens } = state;
  const [triggerXModal, setTriggerXModal] = useState<number | null>(null);
  const populateMode = state.pendingPopulate > 0 && standaloneTokens.length > 0;

  const activeCards = useMemo(() => {
    const grouped = new Map<number, string[]>();
    for (const bc of battlefield) {
      if (!grouped.has(bc.deckCardIndex)) {
        grouped.set(bc.deckCardIndex, []);
      }
      grouped.get(bc.deckCardIndex)!.push(bc.instanceId);
    }
    return grouped;
  }, [battlefield]);

  // Check if we have any landfall or turn-phase generators on the battlefield
  const hasLandfall = battlefield.some(bc => {
    const card = deckCards[bc.deckCardIndex];
    return (card.category === 'token-generator' || card.category === 'both')
      && card.triggerInfo?.type === 'landfall';
  });


  if (state.importStatus !== 'done') return null;

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

  const handleTriggerXConfirm = useCallback((xValue: number) => {
    if (triggerXModal !== null) {
      dispatch({ type: 'TRIGGER_CARD', payload: { deckCardIndex: triggerXModal, xValue } });
      setTriggerXModal(null);
    }
  }, [triggerXModal, dispatch]);

  const handlePopulateSelect = useCallback((token: StandaloneToken) => {
    dispatch({ type: 'ADJUST_TOKEN', payload: { id: token.id, delta: 1 } });
    dispatch({ type: 'RESOLVE_POPULATE' });
  }, [dispatch]);

  const handlePopulateCancel = useCallback(() => {
    dispatch({ type: 'CANCEL_POPULATE' });
  }, [dispatch]);

  const totalTokens = useMemo(
    () => standaloneTokens.reduce((sum, t) => sum + t.finalCount, 0),
    [standaloneTokens]
  );

  const groupedTokens = useMemo(() => {
    const currentTurn = state.currentTurn;
    const grouped = new Map<string, { ids: string[]; totalCount: number; thisTurnCount: number; token: typeof standaloneTokens[0] }>();
    for (const token of standaloneTokens) {
      const key = `${token.tokenDef.name}|${token.tokenDef.power ?? ''}|${token.tokenDef.toughness ?? ''}|${token.sourceName}|${token.copyOfDeckIndex ?? ''}`;
      const existing = grouped.get(key);
      const isThisTurn = token.createdOnTurn === currentTurn;
      if (existing) {
        existing.ids.push(token.id);
        existing.totalCount += token.finalCount;
        if (isThisTurn) existing.thisTurnCount += token.finalCount;
      } else {
        grouped.set(key, { ids: [token.id], totalCount: token.finalCount, thisTurnCount: isThisTurn ? token.finalCount : 0, token });
      }
    }
    return Array.from(grouped.values());
  }, [standaloneTokens, state.currentTurn]);

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
        <h2>Battlefield</h2>
        <div className="battlefield-actions">
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
        </div>
      </div>

      {/* Populate mode banner */}
      {populateMode && (
        <div className="populate-banner">
          <span>Select a token to populate ({state.pendingPopulate} remaining)</span>
          <button className="secondary" onClick={handlePopulateCancel}>Cancel</button>
        </div>
      )}

      {/* Permanent cards in play */}
      {battlefield.length > 0 && (
        <div className={`battlefield-cards${populateMode ? ' populate-dimmed' : ''}`}>
          <h3>Cards in Play</h3>
          {Array.from(activeCards.entries()).map(([deckIdx, instanceIds]) => {
            const card = deckCards[deckIdx];
            const isGenerator = card.category === 'token-generator' || card.category === 'both';
            const triggerLabel = card.triggerInfo?.label;
            const cardHasCondition = card.tokens.some(t => t.isConditional);
            const conditionLabel = card.tokens.find(t => t.isConditional)?.condition;

            return instanceIds.map(instanceId => {
              const bc = battlefield.find(b => b.instanceId === instanceId);
              return (
                <CardRow
                  key={instanceId}
                  card={card}
                  inPlayCount={instanceIds.length}
                  onRemove={() => handleRemoveCard(instanceId)}
                  showRemoveButton
                  onTrigger={isGenerator ? () => handleTrigger(deckIdx) : undefined}
                  triggerLabel={triggerLabel}
                  showCondition={cardHasCondition}
                  conditionMet={bc?.conditionMet ?? false}
                  conditionLabel={conditionLabel}
                  onToggleCondition={() => dispatch({ type: 'TOGGLE_CONDITION', payload: { instanceId } })}
                />
              );
            });
          })}
        </div>
      )}

      {/* All tokens — merged identical tokens */}
      {groupedTokens.length > 0 && (
        <div className="token-battlefield">
          <h3>Tokens ({totalTokens})</h3>
          <div className="token-grid">
            {groupedTokens.map(({ ids, totalCount, thisTurnCount, token }) => {
              const copySource = token.copyOfDeckIndex !== undefined
                ? deckCards[token.copyOfDeckIndex]
                : undefined;
              const copyArtUrl = copySource?.scryfallData.image_uris?.art_crop
                || copySource?.scryfallData.card_faces?.[0]?.image_uris?.art_crop;
              const artUrl = token.tokenArt?.imageUrl || copyArtUrl;
              const artAlt = token.tokenArt?.name || copySource?.scryfallData.name || token.tokenDef.name;

              return (
              <div
                key={ids[0]}
                className={`token-tile${populateMode ? ' populate-selectable' : ''}`}
                onClick={populateMode ? () => handlePopulateSelect(token) : undefined}
                role={populateMode ? 'button' : undefined}
                tabIndex={populateMode ? 0 : undefined}
                onKeyDown={populateMode ? (e) => { if (e.key === 'Enter') handlePopulateSelect(token); } : undefined}
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
                  </div>
                ) : (
                  <div className="token-art-placeholder">
                    <span className="token-count-number">{totalCount}</span>
                  </div>
                )}
                <div className="token-tile-info">
                  <span className="token-tile-name">
                    {token.tokenDef.power && `${token.tokenDef.power}/${token.tokenDef.toughness} `}
                    {token.tokenDef.name}
                  </span>
                  <span className="token-tile-source">
                    from {token.sourceName}
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

      {triggerXModal !== null && (
        <XValueModal
          cardName={deckCards[triggerXModal].scryfallData.name}
          onConfirm={handleTriggerXConfirm}
          onCancel={() => setTriggerXModal(null)}
        />
      )}
    </div>
  );
}
