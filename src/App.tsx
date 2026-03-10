import { useState } from 'react';
import { AppProvider } from './state/AppContext';
import { useAppContext } from './state/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DeckImport } from './components/DeckImport';
import { DeckList } from './components/DeckList';
import { Battlefield } from './components/Battlefield';
import './App.css';

function AppContent() {
  const { state } = useAppContext();
  const [showImport, setShowImport] = useState(true);
  const deckLoaded = state.importStatus === 'done';

  return (
    <div className="app">
      <header className="app-header">
        <h1>MTG Token Tracker</h1>
        <p>Import your deck, play cards, and calculate token generation</p>
        {deckLoaded && !showImport && (
          <button className="change-deck-btn" onClick={() => setShowImport(true)}>
            Change Deck
          </button>
        )}
      </header>
      {(!deckLoaded || showImport) && (
        <DeckImport onDeckLoaded={() => setShowImport(false)} />
      )}
      <div className="main-layout">
        <DeckList />
        <Battlefield />
      </div>
      <footer className="app-footer">
        <p>Card data provided by <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">Scryfall</a></p>
        <p className="disclaimer">MTG Token Tracker is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards of the Coast. Magic: The Gathering, its card images, and its card data are property of Wizards of the Coast, LLC.</p>
      </footer>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
