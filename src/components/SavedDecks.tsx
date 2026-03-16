import { useState } from 'react';
import { useAppContext } from '../state/AppContext';
import { listSavedDecks, saveDeck, deleteSavedDeck } from '../services/localStorage';
import type { SavedDeck } from '../services/localStorage';

export function SavedDecks({ onLoad }: { onLoad?: () => void }) {
  const { state, dispatch } = useAppContext();
  const [decks, setDecks] = useState<SavedDeck[]>(() => listSavedDecks());
  const [saveName, setSaveName] = useState('');

  const deckLoaded = state.importStatus === 'done';

  const handleSave = () => {
    if (!saveName.trim()) return;
    saveDeck(saveName.trim(), state.deckCards, state.rawDecklist);
    setDecks(listSavedDecks());
    setSaveName('');
  };

  const handleLoad = (deck: SavedDeck) => {
    dispatch({ type: 'LOAD_SAVED_DECK', payload: { deckCards: deck.deckCards, rawDecklist: deck.rawDecklist } });
    onLoad?.();
  };

  const handleDelete = (id: string) => {
    deleteSavedDeck(id);
    setDecks(listSavedDecks());
  };

  if (!deckLoaded && decks.length === 0) return null;

  return (
    <div className="saved-decks">
      {deckLoaded && (
        <div className="save-deck-row">
          <input
            type="text"
            className="save-deck-input"
            placeholder="Deck name to save..."
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          />
          <button
            onClick={handleSave}
            disabled={!saveName.trim()}
            className="secondary"
          >
            Save Deck
          </button>
        </div>
      )}

      {decks.length > 0 && (
        <div className="saved-deck-list">
          <h4 className="saved-deck-list-header">Saved Decks</h4>
          {decks.map(deck => (
            <div key={deck.id} className="saved-deck-item">
              <div className="saved-deck-info">
                <span className="saved-deck-name">{deck.name}</span>
                <span className="saved-deck-meta">
                  {deck.deckCards.length} cards · {new Date(deck.savedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="saved-deck-actions">
                <button onClick={() => handleLoad(deck)} className="secondary">Load</button>
                <button onClick={() => handleDelete(deck.id)} className="danger">Del</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
