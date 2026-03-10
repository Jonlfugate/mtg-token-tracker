import { AppProvider } from './state/AppContext';
import { DeckImport } from './components/DeckImport';
import { DeckList } from './components/DeckList';
import { Battlefield } from './components/Battlefield';
import './App.css';

function AppContent() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>MTG Token Tracker</h1>
        <p>Import your deck, play cards, and calculate token generation</p>
      </header>
      <DeckImport />
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
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
