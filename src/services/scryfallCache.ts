import type { ScryfallCard, TokenArt, ScryfallTokenData } from '../types';

const DB_NAME = 'mtg-token-tracker-cache';
const DB_VERSION = 1;
const CARD_STORE = 'cards';
const TOKEN_STORE = 'tokens';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedCard {
  key: string; // lowercase card name
  card: ScryfallCard;
  tokenArt: TokenArt[];
  tokenData: ScryfallTokenData[];
  fetchedAt: number;
}

interface CachedToken {
  uri: string;
  art: TokenArt | null;
  data: ScryfallTokenData | null;
  fetchedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CARD_STORE)) {
        db.createObjectStore(CARD_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(TOKEN_STORE)) {
        db.createObjectStore(TOKEN_STORE, { keyPath: 'uri' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedCard(name: string): Promise<CachedCard | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CARD_STORE, 'readonly');
      const store = tx.objectStore(CARD_STORE);
      const request = store.get(name.toLowerCase());
      request.onsuccess = () => {
        const result = request.result as CachedCard | undefined;
        if (result && Date.now() - result.fetchedAt < TTL_MS) {
          resolve(result);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedCard(
  name: string,
  card: ScryfallCard,
  tokenArt: TokenArt[],
  tokenData: ScryfallTokenData[],
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(CARD_STORE, 'readwrite');
    const store = tx.objectStore(CARD_STORE);
    const entry: CachedCard = {
      key: name.toLowerCase(),
      card,
      tokenArt,
      tokenData,
      fetchedAt: Date.now(),
    };
    store.put(entry);
  } catch {
    // Silently fail — caching is best-effort
  }
}

export async function getCachedToken(uri: string): Promise<CachedToken | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(TOKEN_STORE, 'readonly');
      const store = tx.objectStore(TOKEN_STORE);
      const request = store.get(uri);
      request.onsuccess = () => {
        const result = request.result as CachedToken | undefined;
        if (result && Date.now() - result.fetchedAt < TTL_MS) {
          resolve(result);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedToken(
  uri: string,
  art: TokenArt | null,
  data: ScryfallTokenData | null,
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(TOKEN_STORE, 'readwrite');
    const store = tx.objectStore(TOKEN_STORE);
    const entry: CachedToken = { uri, art, data, fetchedAt: Date.now() };
    store.put(entry);
  } catch {
    // Silently fail
  }
}

export async function clearCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([CARD_STORE, TOKEN_STORE], 'readwrite');
    tx.objectStore(CARD_STORE).clear();
    tx.objectStore(TOKEN_STORE).clear();
  } catch {
    // Silently fail
  }
}
