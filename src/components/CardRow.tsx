import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DeckCard, TokenDefinition } from '../types';

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

const CATEGORY_LABELS: Record<string, string> = {
  'token-generator': 'Token Generator',
  'support': 'Support',
  'both': 'Generator + Support',
  'other': '',
};

const CATEGORY_COLORS: Record<string, string> = {
  'token-generator': '#4caf50',
  'support': '#ff9800',
  'both': '#9c27b0',
  'other': 'transparent',
};

const TRIGGER_COLORS: Record<string, string> = {
  'landfall': '#16a34a',
  'upkeep': '#2563eb',
  'combat': '#dc2626',
  'etb': '#d97706',
  'tap': '#6366f1',
  'other': '#6b7280',
};

function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
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

  // For "Copy of X" tokens, use the source card's own art
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
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [above, setAbove] = useState(false);

  const calcPosition = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setAbove(rect.bottom + 220 > window.innerHeight);
    }
  };

  const handleEnter = () => {
    calcPosition();
    setShow(true);
  };

  const handleTap = useCallback((e: React.MouseEvent) => {
    if (!isTouchDevice()) return;
    e.stopPropagation();
    calcPosition();
    setShow(prev => !prev);
  }, []);

  // Close on outside tap
  useEffect(() => {
    if (!show || !isTouchDevice()) return;
    const close = (e: TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener('touchstart', close);
    return () => document.removeEventListener('touchstart', close);
  }, [show]);

  const label = `${tokenDef.count === -1 ? 'X' : tokenDef.count}× ${tokenDef.power ? `${tokenDef.power}/${tokenDef.toughness} ` : ''}${tokenDef.name}`;

  return (
    <span
      ref={ref}
      className="token-thumb"
      onMouseEnter={!isTouchDevice() ? handleEnter : undefined}
      onMouseLeave={!isTouchDevice() ? () => setShow(false) : undefined}
      onClick={handleTap}
      title={label}
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt={tokenDef.name} className="token-thumb-img" loading="lazy" />
      ) : (
        <span className="token-thumb-text">{tokenDef.name.charAt(0)}</span>
      )}
      {show && (
        <div className={`token-thumb-popup${above ? ' popup-above' : ''}`}>
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
  const [showImage, setShowImage] = useState(false);
  const [popupAbove, setPopupAbove] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const imageUri = getImageUri(card);
  const artCropUri = getArtCropUri(card);
  const maxQty = card.decklistEntry.quantity;
  const canPlay = inPlayCount < maxQty;

  const handleMouseEnter = () => {
    if (isTouchDevice()) return;
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setPopupAbove(rect.top + 350 > window.innerHeight);
    }
    setShowImage(true);
  };

  const handleTap = useCallback((e: React.MouseEvent) => {
    if (!isTouchDevice()) return;
    // Don't show popup if tapping on buttons or interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('button, input, label, .token-thumb')) return;
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setPopupAbove(rect.top + 350 > window.innerHeight);
    }
    setShowImage(prev => !prev);
  }, []);

  // Close card popup on outside tap
  useEffect(() => {
    if (!showImage || !isTouchDevice()) return;
    const close = (e: TouchEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setShowImage(false);
      }
    };
    document.addEventListener('touchstart', close);
    return () => document.removeEventListener('touchstart', close);
  }, [showImage]);

  return (
    <div
      ref={rowRef}
      className={`card-row category-${card.category}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={!isTouchDevice() ? () => setShowImage(false) : undefined}
      onClick={handleTap}
    >
      {artCropUri && (
        <img
          src={artCropUri}
          alt=""
          className="card-thumbnail"
          loading="lazy"
        />
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

      {showImage && imageUri && (
        <div className={`card-image-popup${popupAbove ? ' popup-above' : ''}`}>
          <img src={imageUri} alt={card.scryfallData.name} />
        </div>
      )}
    </div>
  );
});
