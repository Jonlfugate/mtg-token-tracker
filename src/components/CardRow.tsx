import { memo, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { DeckCard, TokenDefinition } from '../types';
import { CATEGORY_LABELS, CATEGORY_COLORS, TRIGGER_COLORS } from '../constants';
import { usePopup, isTouch } from '../hooks/usePopup';

interface CardRowProps {
  card: DeckCard;
  inPlayCount: number;
  onPlay?: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
  onRemoveAll?: () => void;
  showPlayButton?: boolean;
  showRemoveButton?: boolean;
  extraLabel?: string;
  onTrigger?: () => void;
  triggerLabel?: string;
  conditions?: Array<{ tokenName: string; label: string; checked: boolean; group?: string; isReplacement?: boolean }>;
  onToggleCondition?: (tokenName: string) => void;
  children?: ReactNode;
  compact?: boolean;
}

function getArtCropUri(card: DeckCard): string | undefined {
  const data = card.scryfallData;
  return data.image_uris?.art_crop || data.card_faces?.[0]?.image_uris?.art_crop;
}

function getImageUri(card: DeckCard): string | undefined {
  const data = card.scryfallData;
  return data.image_uris?.normal || data.card_faces?.[0]?.image_uris?.normal;
}

function findTokenArt(tokenDef: TokenDefinition, card: DeckCard): { thumbUrl?: string; popupUrl?: string } {
  const name = tokenDef.name.toLowerCase();

  if (name.startsWith('copy of ')) {
    const artCrop = card.scryfallData.image_uris?.art_crop || card.scryfallData.card_faces?.[0]?.image_uris?.art_crop;
    const normal = card.scryfallData.image_uris?.normal || card.scryfallData.card_faces?.[0]?.image_uris?.normal;
    return { thumbUrl: artCrop || normal, popupUrl: normal || artCrop };
  }

  const art = card.tokenArt.find(a => a.name.toLowerCase() === name)
    || card.tokenArt.find(a => name.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(name));

  if (art) {
    return { thumbUrl: art.imageUrl, popupUrl: art.normalUrl || art.imageUrl };
  }
  return {};
}

function TokenThumb({ tokenDef, thumbUrl, popupUrl }: { tokenDef: TokenDefinition; thumbUrl?: string; popupUrl?: string }) {
  const { ref, show, popupStyle, handlers } = usePopup({
    popupWidth: 160,
    popupHeight: 230,
    placement: 'below',
  });

  const label = `${tokenDef.count === -1 ? 'X' : tokenDef.count}× ${tokenDef.power ? `${tokenDef.power}/${tokenDef.toughness} ` : ''}${tokenDef.name}`;

  return (
    <span
      ref={ref as React.RefObject<HTMLSpanElement>}
      className="token-thumb"
      {...handlers}
      title={label}
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt={tokenDef.name} className="token-thumb-img" loading="lazy" />
      ) : (
        <span className="token-thumb-text">{tokenDef.name.charAt(0)}</span>
      )}
      {show && (
        <div className="token-thumb-popup" style={popupStyle}>
          {popupUrl && <img src={popupUrl} alt={tokenDef.name} />}
          <span className="token-thumb-popup-label">{label}</span>
        </div>
      )}
    </span>
  );
}

function CardPopupTokens({ card }: { card: DeckCard }) {
  const tokens = card.tokens.filter(t => t.countMode !== 'double-tokens' && t.countMode !== 'copy-turn-tokens');
  if (tokens.length === 0) return null;
  return (
    <div className="popup-token-row">
      {tokens.map((t, i) => {
        const { popupUrl } = findTokenArt(t, card);
        const label = `${t.count === -1 ? 'X' : t.count}× ${t.power ? `${t.power}/${t.toughness} ` : ''}${t.name}`;
        return popupUrl ? (
          <div key={i} className="popup-token-item" title={label}>
            <div className="popup-token-img-wrap">
              <img src={popupUrl} alt={t.name} className="popup-token-img" loading="lazy" />
              <span className="popup-token-badge">
                {t.count === -1 ? '×X' : `×${t.count}`}
              </span>
            </div>
            <span className="popup-token-name">{t.name}</span>
          </div>
        ) : (
          <div key={i} className="popup-token-item popup-token-text" title={label}>
            {label}
          </div>
        );
      })}
    </div>
  );
}

export const CardRow = memo(function CardRow({
  card, inPlayCount,
  onPlay, onAdd, onRemove, onRemoveAll, showPlayButton, showRemoveButton, extraLabel,
  onTrigger, triggerLabel,
  conditions, onToggleCondition, children,
  compact,
}: CardRowProps) {
  const imageUri = getImageUri(card);
  const artCropUri = getArtCropUri(card);

  // Desktop: near-mouse popup. Touch: below popup.
  // Width: 250px card + each token adds ~210px (200px + gap).
  const visibleTokenCount = card.tokens.filter(t => t.countMode !== 'double-tokens' && t.countMode !== 'copy-turn-tokens').length;
  const popupWidth = 260 + visibleTokenCount * 210;
  const popupHeight = 380;
  const desktopPopup = usePopup({ popupWidth, popupHeight, placement: 'mouse' });
  const touchPopup = usePopup({ popupWidth, popupHeight, placement: 'below' });

  const handleRowMouseEnter = desktopPopup.handlers.onMouseEnter;
  const handleRowMouseLeave = desktopPopup.handlers.onMouseLeave;

  const handleRowClick = useCallback((e: React.MouseEvent) => {
    if (!isTouch) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, label, .token-thumb')) return;
    touchPopup.handlers.onClick(e);
  }, [touchPopup.handlers]);

  // Sync touch popup ref to same element
  const setRefs = useCallback((el: HTMLDivElement | null) => {
    (desktopPopup.ref as React.MutableRefObject<HTMLElement | null>).current = el;
    (touchPopup.ref as React.MutableRefObject<HTMLElement | null>).current = el;
  }, [desktopPopup.ref, touchPopup.ref]);

  return (
    <div
      ref={setRefs}
      className={`card-row category-${card.category}`}
      onMouseEnter={handleRowMouseEnter}
      onMouseLeave={handleRowMouseLeave}
      onClick={handleRowClick}
    >
      {artCropUri && (
        <img src={artCropUri} alt="" className="card-thumbnail" loading="lazy" />
      )}
      <div className="card-info">
        <span className="card-name">
          {card.scryfallData.name}{extraLabel}
        </span>
        {!compact && card.category !== 'other' && (
          <span
            className="category-badge"
            style={{ backgroundColor: CATEGORY_COLORS[card.category] }}
          >
            {CATEGORY_LABELS[card.category]}
          </span>
        )}
        {card.triggerInfo && !compact && (
          <span
            className="trigger-badge"
            style={{ backgroundColor: TRIGGER_COLORS[card.triggerInfo.type] ?? TRIGGER_COLORS['other'] }}
          >
            {card.triggerInfo.label}
            {card.triggerInfo.alsoEtb && ' + ETB'}
          </span>
        )}
        {!compact && (
          <span className="card-qty">
            {showPlayButton ? `${inPlayCount} in play` : `×${card.decklistEntry.quantity}`}
          </span>
        )}
      </div>

      {!compact && (
        <div className="card-details">
          <span className="card-type">{card.scryfallData.type_line}</span>
          {card.tokens.length > 0 && (
            <span className="token-info">
              {card.tokens.map((t, i) => (
                <span key={i} className="token-badge">
                  {t.count === -1 ? 'X' : t.count}× {t.power && `${t.power}/${t.toughness} `}{t.name}
                </span>
              ))}
            </span>
          )}
          {card.supportEffects.length > 0 && card.supportEffects.map((effect, i) => (
            <span key={i} className="support-info">
              {effect.type === 'multiplier'
                ? `×${effect.factor} tokens`
                : effect.type === 'additional'
                ? `+${effect.factor} token`
                : `companion`}
              {effect.condition && ` (${effect.condition})`}
            </span>
          ))}
        </div>
      )}

      {compact && card.supportEffects.length > 0 && card.supportEffects.map((effect, i) => (
        <span key={i} className="support-info">
          {effect.type === 'multiplier'
            ? `×${effect.factor} tokens`
            : effect.type === 'additional'
            ? `+${effect.factor} token`
            : `companion`}
          {effect.condition && ` (${effect.condition})`}
        </span>
      ))}

      {conditions && conditions.length > 0 && (() => {
        const ungrouped = conditions.filter(c => !c.group);
        const groupMap = new Map<string, typeof conditions[0][]>();
        for (const c of conditions.filter(c => c.group)) {
          if (!groupMap.has(c.group!)) groupMap.set(c.group!, []);
          groupMap.get(c.group!)!.push(c);
        }
        return (
          <>
            {ungrouped.map(cond => (
              <label key={cond.tokenName} className="condition-toggle" title={cond.label}>
                <input
                  type="checkbox"
                  checked={cond.checked}
                  onChange={() => onToggleCondition?.(cond.tokenName)}
                />
                <span className="condition-label">{cond.label}</span>
              </label>
            ))}
            {Array.from(groupMap.values()).map(group => {
              const activeIdx = group.findIndex(c => c.checked);

              // 2-option group
              if (group.length === 2) {
                const replacement = group.find(c => c.isReplacement);
                const base = group.find(c => !c.isReplacement);

                // Base + replacement pair: render as a toggle switch with condition label only.
                // Unchecked = base token (default); checked = replacement token.
                if (replacement && base) {
                  const isOn = replacement.checked;
                  return (
                    <div key={group[0].group} className="condition-or-switch-row">
                      <span className="condition-label">{base.label}</span>
                      <button
                        className={`condition-or-track${isOn ? ' right' : ' left'}`}
                        onClick={() => onToggleCondition?.(replacement.tokenName)}
                        aria-label={`Toggle: ${base.label} or ${replacement.label}`}
                      >
                        <div className="condition-or-knob" />
                      </button>
                      <span className="condition-label">{replacement.label}</span>
                    </div>
                  );
                }

                // Two equal-weight choices: sliding switch
                const [left, right] = group;
                const effectiveActiveIdx = activeIdx >= 0 ? activeIdx : 1;
                const trackClass = effectiveActiveIdx === 0 ? ' left' : ' right';
                const handleTrackClick = () => {
                  const target = effectiveActiveIdx === 1 ? left : right;
                  if (!target.checked) onToggleCondition?.(target.tokenName);
                };
                return (
                  <div key={group[0].group} className="condition-or-switch-row">
                    <button
                      className="condition-label"
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      onClick={() => { if (!left.checked) onToggleCondition?.(left.tokenName); }}
                    >
                      {left.label}
                    </button>
                    <button
                      className={`condition-or-track${trackClass}`}
                      onClick={handleTrackClick}
                      aria-label={`Toggle: ${left.label} or ${right.label}`}
                    >
                      <div className="condition-or-knob" />
                    </button>
                    <button
                      className="condition-label"
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      onClick={() => { if (!right.checked) onToggleCondition?.(right.tokenName); }}
                    >
                      {right.label}
                    </button>
                  </div>
                );
              }

              // 3+ options: segmented radio buttons
              return (
                <div key={group[0].group} className="condition-or-segment">
                  {group.map(cond => (
                    <button
                      key={cond.tokenName}
                      className={`condition-or-segment-btn${cond.checked ? ' active' : ''}`}
                      onClick={() => { if (!cond.checked) onToggleCondition?.(cond.tokenName); }}
                    >
                      {cond.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </>
        );
      })()}

      <div className="card-actions">
        {children}
        {onTrigger && (
          <button
            onClick={onTrigger}
            className="trigger-btn"
            title={`Trigger: ${triggerLabel || 'Activate'}`}
            style={card.triggerInfo ? {
              backgroundColor: TRIGGER_COLORS[card.triggerInfo.type] ?? TRIGGER_COLORS['other'],
            } : undefined}
          >
            {triggerLabel || 'Activate'}
          </button>
        )}
        {showPlayButton && (
          <button onClick={onPlay} className="play-btn">
            Play
          </button>
        )}
        {showRemoveButton && (
          <div className="card-adjust-btns">
            <button onClick={onRemove} className="card-adjust-btn" title="Remove one">
              &minus;
            </button>
            <span className="card-adjust-count">{inPlayCount}</span>
            {onAdd && (
              <button onClick={onAdd} className="card-adjust-btn" title="Add one">
                +
              </button>
            )}
            {onRemoveAll && (
              <button onClick={onRemoveAll} className="card-remove-all-btn" title="Remove all copies">
                &times;
              </button>
            )}
          </div>
        )}
      </div>

      {desktopPopup.show && imageUri && !isTouch && (
        <div className="card-image-popup" style={desktopPopup.popupStyle}>
          <img src={imageUri} alt={card.scryfallData.name} />
          <CardPopupTokens card={card} />
        </div>
      )}

      {touchPopup.show && imageUri && isTouch && (
        <div className="card-image-popup" style={touchPopup.popupStyle}>
          <img src={imageUri} alt={card.scryfallData.name} />
          <CardPopupTokens card={card} />
        </div>
      )}
    </div>
  );
});
