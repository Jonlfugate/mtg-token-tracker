import { useState } from 'react';
import { useDeckImport } from '../hooks/useDeckImport';
import { useAppContext } from '../state/AppContext';

const EXAMPLE_DECK = `4 Hare Apparent (MKM) 14
1 Doubling Season (2X2) 175
1 Parallel Lives (ISD) 199
1 Anointed Procession (AKH) 2
1 Mondrak, Glory Dominus (ONE) 17
1 Avenger of Zendikar (ZNC) 57
1 Scute Swarm (ZNR) 203
1 Tendershoot Dryad (RIX) 147
1 Mycoloth (PCA) 70
1 Secure the Wastes (DTK) 36
1 March of the Multitudes (NCC) 346
1 Adeline, Resplendent Cathar (MID) 1
1 Rhys the Redeemed (SHM) 237
1 Felidar Retreat (ZNR) 16
1 Verdant Force (DOM) 187
1 Court of Grace (CMR) 16
1 Ocelot Pride (MH3) 38
1 Hornet Queen (DSC) 184
1 Angel of Invention (TDC) 109
1 Dreadhorde Invasion (CMM) 866
1 Sifter of Skulls (OGW) 77
1 Pawn of Ulamog (C17) 120
1 Smothering Tithe
1 Black Market Connections
1 Tireless Provisioner
1 Professional Face-Breaker
1 Pitiless Plunderer
1 Goldspan Dragon
1 Treasure Vault
1 Curse of Opulence
1 Old Gnawbone
1 Xorn
1 Bitterblossom
1 Ophiomancer
1 Loyal Apprentice
1 Talrand, Sky Summoner
1 Rampaging Baloths
1 Omnath, Locus of Rage
1 Field of the Dead
1 Castle Ardenvale
1 Wurmcoil Engine
1 Chasm Skulker
1 Lathliss, Dragon Queen
1 Anim Pakal, Thousandth Moon
1 Helm of the Host
1 Rite of Replication
1 Irenicus's Vile Duplication
1 Myr Battlesphere
1 Academy Manufactor
1 Descent into Avernus
1 Thopter Spy Network
1 Bastion of Remembrance
1 Maskwood Nexus
1 Chatterfang, Squirrel General
1 Second Harvest
1 Curse of the Swine
1 Strix Serenade
1 Forbidden Orchard
1 Sokenzan, Crucible of Defiance
1 Pongify
1 Beast Within
1 Swan Song
1 Generous Gift
1 Rapid Hybridization
1 Oketra's Monument
1 Titania, Protector of Argoth
1 Ancient Copper Dragon
1 Gilded Goose
1 Not Dead After All`;

export function DeckImport({ onDeckLoaded }: { onDeckLoaded?: () => void }) {
  const [text, setText] = useState('');
  const { importDeck } = useDeckImport();
  const { state, dispatch } = useAppContext();

  const isLoading = state.importStatus === 'fetching';

  const handleImport = async () => {
    if (text.trim()) {
      await importDeck(text);
      onDeckLoaded?.();
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
