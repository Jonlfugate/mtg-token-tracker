import { memo, useState } from 'react';
import type { DeckCard } from '../types';

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
  showCondition?: boolean;
  conditionMet?: boolean;
  conditionLabel?: string;
  onToggleCondition?: () => void;
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

function getImageUri(card: DeckCard): string | undefined {
  const data = card.scryfallData;
  return data.image_uris?.normal || data.card_faces?.[0]?.image_uris?.normal;
}

export const CardRow = memo(function CardRow({
  card, inPlayCount,
  onPlay, onRemove, showPlayButton, showRemoveButton, extraLabel,
  onTrigger, triggerLabel,
  showCondition, conditionMet, conditionLabel, onToggleCondition,
}: CardRowProps) {
  const [showImage, setShowImage] = useState(false);
  const imageUri = getImageUri(card);
  const maxQty = card.decklistEntry.quantity;
  const canPlay = inPlayCount < maxQty;

  return (
    <div className={`card-row category-${card.category}`}>
      <div className="card-info">
        <span
          className="card-name"
          onMouseEnter={() => setShowImage(true)}
          onMouseLeave={() => setShowImage(false)}
        >
          {card.scryfallData.name}{extraLabel}
        </span>
        {card.category !== 'other' && (
          <span
            className="category-badge"
            style={{ backgroundColor: CATEGORY_COLORS[card.category] }}
          >
            {CATEGORY_LABELS[card.category]}
          </span>
        )}
        <span className="card-qty">
          {showPlayButton ? `${inPlayCount}/${maxQty} in play` : `×${maxQty}`}
        </span>
      </div>

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

      {showCondition && (
        <label className="condition-toggle" title={conditionLabel || 'Condition'}>
          <input
            type="checkbox"
            checked={conditionMet ?? false}
            onChange={onToggleCondition}
          />
          <span className="condition-label">{conditionLabel || 'Condition met'}</span>
        </label>
      )}

      <div className="card-actions">
        {onTrigger && (
          <button onClick={onTrigger} className="trigger-btn" title={`Trigger: ${triggerLabel || 'Activate'}`}>
            {triggerLabel || 'Activate'}
          </button>
        )}
        {showPlayButton && (
          <button onClick={onPlay} disabled={!canPlay} className="play-btn">
            Play
          </button>
        )}
        {showRemoveButton && (
          <button onClick={onRemove} className="remove-btn">
            Remove
          </button>
        )}
      </div>

      {showImage && imageUri && (
        <div className="card-image-popup">
          <img src={imageUri} alt={card.scryfallData.name} />
        </div>
      )}
    </div>
  );
});
