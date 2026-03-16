import { useState, useCallback, useEffect } from 'react';
import { AppProvider } from './state/AppContext';
import { useAppContext } from './state/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DeckImport } from './components/DeckImport';
import { DeckList } from './components/DeckList';
import { Battlefield } from './components/Battlefield';
import { SavedDecks } from './components/SavedDecks';
import { Tutorial } from './components/Tutorial';
import { TUTORIAL_DECKLIST, TUTORIAL_STEPS } from './data/tutorialDeck';
import { useDeckImport } from './hooks/useDeckImport';
import './App.css';

function AppContent() {
  const { state } = useAppContext();
  const { importDeck } = useDeckImport();
  const [showImport, setShowImport] = useState(true);
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const deckLoaded = state.importStatus === 'done';

  // Dismiss tutorial if deck is reset
  useEffect(() => {
    if (state.importStatus === 'idle') setTutorialStep(null);
  }, [state.importStatus]);

  const startTutorial = useCallback(async () => {
    setShowImport(false);
    await importDeck(TUTORIAL_DECKLIST);
    setTutorialStep(0);
  }, [importDeck]);

  const handleTutorialAdvance = useCallback(() => {
    setTutorialStep(prev => {
      if (prev === null) return null;
      const next = prev + 1;
      return next >= TUTORIAL_STEPS.length ? null : next;
    });
  }, []);

  const handleTutorialSkip = useCallback(() => {
    setTutorialStep(null);
  }, []);

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
        <>
          <DeckImport
            onDeckLoaded={() => setShowImport(false)}
            onStartTutorial={startTutorial}
          />
          <SavedDecks onLoad={() => setShowImport(false)} />
        </>
      )}
      <div className="main-layout">
        <DeckList />
        <Battlefield />
      </div>
      {tutorialStep !== null && (
        <Tutorial
          step={tutorialStep}
          onAdvance={handleTutorialAdvance}
          onSkip={handleTutorialSkip}
        />
      )}
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
