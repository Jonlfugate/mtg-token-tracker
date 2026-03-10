import { useState, useEffect, useRef } from 'react';

interface XValueModalProps {
  cardName: string;
  onConfirm: (xValue: number) => void;
  onCancel: () => void;
}

export function XValueModal({ cardName, onConfirm, onCancel }: XValueModalProps) {
  const [value, setValue] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(Math.max(0, value));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="modal-overlay" onClick={onCancel} onKeyDown={handleKeyDown} role="presentation">
      <div className="modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Set X value for ${cardName}`}>
        <h3>Set X Value</h3>
        <p className="modal-card-name">{cardName}</p>
        <p className="modal-hint">How many tokens does X equal?</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="x-value-input" className="sr-only">X value</label>
          <input
            id="x-value-input"
            ref={inputRef}
            type="number"
            min={0}
            max={999}
            value={value}
            onChange={e => setValue(parseInt(e.target.value) || 0)}
            onKeyDown={handleKeyDown}
            className="modal-input"
            aria-label="X value"
          />
          <div className="modal-actions">
            <button type="submit" className="modal-confirm">Confirm</button>
            <button type="button" onClick={onCancel} className="secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
