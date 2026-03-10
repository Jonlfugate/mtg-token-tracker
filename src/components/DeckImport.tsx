import { useState } from 'react';
import { useDeckImport } from '../hooks/useDeckImport';
import { useAppContext } from '../state/AppContext';

const EXAMPLE_DECK = `1 Doubling Season (2X2) 175
1 Parallel Lives (ISD) 199
1 Anointed Procession (AKH) 2
1 Mondrak, Glory Dominus (ONE) 17
1 Avenger of Zendikar (ZNC) 57
1 Scute Swarm (ZNR) 203
1 Tendershoot Dryad (RIX) 147
1 Mycoloth (PCA) 70
1 Verdant Force (DOM) 187
1 Felidar Retreat (ZNR) 16
37 Forest (ZNR) 384`;

export function DeckImport() {
  const [text, setText] = useState('');
  const { importDeck } = useDeckImport();
  const { state, dispatch } = useAppContext();

  const isLoading = state.importStatus === 'fetching';

  const handleImport = () => {
    if (text.trim()) {
      importDeck(text);
    }
  };

  const handleLoadExample = () => {
    setText(EXAMPLE_DECK);
  };

  return (
    <div className="deck-import">
      <h2>Import Decklist</h2>
      <p className="hint">Paste your decklist from Moxfield (format: "1 Card Name" per line)</p>
      <label htmlFor="decklist-input" className="sr-only">Decklist</label>
      <textarea
        id="decklist-input"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`1 Doubling Season (2X2) 175\n1 Avenger of Zendikar (ZNC) 57\n4 Forest (ZNR) 384`}
        rows={12}
        disabled={isLoading}
        aria-label="Decklist input"
      />
      <div className="deck-import-actions">
        <button onClick={handleImport} disabled={isLoading || !text.trim()}>
          {isLoading ? 'Importing...' : 'Import Deck'}
        </button>
        <button onClick={handleLoadExample} disabled={isLoading} className="secondary">
          Load Example
        </button>
        {state.importStatus === 'done' && (
          <button onClick={() => dispatch({ type: 'RESET' })} className="danger">
            Clear Deck
          </button>
        )}
      </div>

      {isLoading && (
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${(state.fetchProgress.done / state.fetchProgress.total) * 100}%` }}
          />
          <span className="progress-text">
            Fetching cards... {state.fetchProgress.done}/{state.fetchProgress.total}
          </span>
        </div>
      )}

      {state.error && <div className="error-message">{state.error}</div>}
    </div>
  );
}
