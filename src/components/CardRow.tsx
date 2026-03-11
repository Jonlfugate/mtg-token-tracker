import { memo, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { DeckCard, TokenDefinition } from '../types';
import { CATEGORY_LABELS, CATEGORY_COLORS, TRIGGER_COLORS } from '../constants';
import { usePopup, isTouch } from '../hooks/usePopup';

interface CardRowProps {
  card: DeckCard;
  inPlayCount: number;
  onPlay?: () => void;
  onRemove?: () => void;
  showPlayButton?: boolean;
  showRemoveButton?: boolean;
  extraLabel?: string;
  onTrigger?: () => void;
  triggerLabel?: string;
  conditions?: Array<{ tokenName: string; label: string; checked: boolean }>;
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

export const CardRow = memo(function CardRow({
  card, inPlayCount,
  onPlay, onRemove, showPlayButton, showRemoveButton, extraLabel,
  onTrigger, triggerLabel,
  conditions, onToggleCondition, children,
  compact,
}: CardRowProps) {
  const imageUri = getImageUri(card);
  const artCropUri = getArtCropUri(card);
  const maxQty = card.decklistEntry.quantity;
  const canPlay = inPlayCount < maxQty;

  // Desktop: side popup. Touch: below popup.
  const desktopPopup = usePopup({ popupWidth: 260, popupHeight: 350, placement: 'side' });
  const touchPopup = usePopup({ popupWidth: 250, popupHeight: 350, placement: 'below' });

  const handleRowMouseEnter = desktopPopup.handlers.onMouseEnter;
  const handleRowMouseLeave = desktopPopup.handlers.onMouseLeave;

  const handleRowClick = useCallback((e: React.MouseEvent) => {
    if (!isTouch) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, label, .token-thumb')) return;
    touchPopup.handlers.onClick(e);
  }, [touchPopup.handlers]);

  // Use the desktop ref for the row element (both popups reference the same row)
  const rowRef = desktopPopup.ref as React.RefObject<HTMLDivElement>;

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
        {card.triggerInfo && (
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
            {showPlayButton ? `${inPlayCount}/${maxQty} in play` : `×${maxQty}`}
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
          {card.supportEffect && (
            <span className="support-info">
              {card.supportEffect.type === 'multiplier'
                ? `×${card.supportEffect.factor} tokens`
                : `+${card.supportEffect.factor} token`}
              {card.supportEffect.condition && ` (${card.supportEffect.condition})`}
            </span>
          )}
        </div>
      )}

      {compact && card.tokens.length > 0 && (
        <span className="token-thumbs">
          {card.tokens.map((t, i) => {
            const { thumbUrl, popupUrl } = findTokenArt(t, card);
            return <TokenThumb key={i} tokenDef={t} thumbUrl={thumbUrl} popupUrl={popupUrl} />;
          })}
        </span>
      )}

      {compact && card.supportEffect && (
        <span className="support-info">
          {card.supportEffect.type === 'multiplier'
            ? `×${card.supportEffect.factor} tokens`
            : `+${card.supportEffect.factor} token`}
          {card.supportEffect.condition && ` (${card.supportEffect.condition})`}
        </span>
      )}

      {conditions && conditions.length > 0 && conditions.map(cond => (
        <label key={cond.tokenName} className="condition-toggle" title={cond.label}>
          <input
            type="checkbox"
            checked={cond.checked}
            onChange={() => onToggleCondition?.(cond.tokenName)}
          />
          <span className="condition-label">{cond.label}</span>
        </label>
      ))}

      {children}

      <div className="card-actions">
        {onTrigger && (
          <button onClick={onTrigger} className="trigger-btn" title={`Trigger: ${triggerLabel || 'Activate'}`}>
            {triggerLabel || 'Activate'}
          </button>
        )}
        {showPlayButton && (
          <div className="play-btn-group">
            <button onClick={onPlay} disabled={!canPlay} className="play-btn">
              Play
            </button>
            <span className="play-counter">{inPlayCount}/{maxQty}</span>
          </div>
        )}
        {showRemoveButton && (
          <button onClick={onRemove} className="remove-btn">
            Remove
          </button>
        )}
      </div>

      {desktopPopup.show && imageUri && !isTouch && (
        <div className="card-image-popup" style={desktopPopup.popupStyle}>
          <img src={imageUri} alt={card.scryfallData.name} />
        </div>
      )}

      {touchPopup.show && imageUri && isTouch && (
        <div className="card-image-popup" style={touchPopup.popupStyle}>
          <img src={imageUri} alt={card.scryfallData.name} />
        </div>
      )}
    </div>
  );
});
