import type { ScryfallCard, TokenArt, ScryfallTokenData } from '../types';
import { getCachedCard, setCachedCard, getCachedToken, setCachedToken } from './scryfallCache';

const BASE_URL = 'https://api.scryfall.com';
const REQUEST_DELAY_MS = 80;
const FETCH_TIMEOUT_MS = 10000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    // Handle rate limiting with backoff
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
      await delay(retryAfter * 1000);
      return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    }
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCard(name: string): Promise<ScryfallCard> {
  const url = `${BASE_URL}/cards/named?exact=${encodeURIComponent(name)}`;
  let res = await fetchWithTimeout(url);

  // Fallback to fuzzy search if exact match fails
  if (!res.ok) {
    const fuzzyUrl = `${BASE_URL}/cards/named?fuzzy=${encodeURIComponent(name)}`;
    res = await fetchWithTimeout(fuzzyUrl);
  }

  if (!res.ok) {
    throw new Error(`Card not found: "${name}"`);
  }

  return res.json();
}

const COLOR_MAP: Record<string, string> = {
  W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green',
};

interface FetchedTokenResult {
  art: TokenArt | null;
  data: ScryfallTokenData | null;
}

async function fetchTokenCard(uri: string): Promise<FetchedTokenResult> {
  try {
    const res = await fetchWithTimeout(uri);
    if (!res.ok) return { art: null, data: null };
    const raw = await res.json();
    const data = raw as ScryfallCard;
    const artCrop = data.image_uris?.art_crop
      || data.card_faces?.[0]?.image_uris?.art_crop;
    const normalImg = data.image_uris?.normal
      || data.card_faces?.[0]?.image_uris?.normal;
    const imageUrl = artCrop || normalImg;

    const art: TokenArt | null = imageUrl ? {
      name: data.name,
      imageUrl,
      normalUrl: normalImg || undefined,
      typeLine: data.type_line,
      power: raw.power || undefined,
      toughness: raw.toughness || undefined,
    } : null;

    const tokenData: ScryfallTokenData = {
      name: data.name,
      power: raw.power || undefined,
      toughness: raw.toughness || undefined,
      colors: (raw.colors || []).map((c: string) => COLOR_MAP[c] || c.toLowerCase()),
      type_line: data.type_line,
      keywords: raw.keywords || [],
      oracle_text: data.oracle_text,
      imageUrl: imageUrl || undefined,
    };

    return { art, data: tokenData };
  } catch {
    return { art: null, data: null };
  }
}

export async function fetchAllCards(
  cardNames: string[],
  onProgress: (done: number, total: number) => void
): Promise<Map<string, { card: ScryfallCard; tokenArt: TokenArt[]; tokenData: ScryfallTokenData[] }>> {
  const results = new Map<string, { card: ScryfallCard; tokenArt: TokenArt[]; tokenData: ScryfallTokenData[] }>();
  const uniqueNames = [...new Set(cardNames)];

  // Phase 0: Check cache for all cards
  const uncachedNames: string[] = [];
  for (const name of uniqueNames) {
    const cached = await getCachedCard(name);
    if (cached) {
      results.set(name, { card: cached.card, tokenArt: cached.tokenArt, tokenData: cached.tokenData });
    } else {
      uncachedNames.push(name);
    }
  }

  const cachedCount = uniqueNames.length - uncachedNames.length;

  // Phase 1: Fetch uncached cards from Scryfall
  const cardMap = new Map<string, ScryfallCard>();
  for (let i = 0; i < uncachedNames.length; i++) {
    const name = uncachedNames[i];
    try {
      const card = await fetchCard(name);
      cardMap.set(name, card);
    } catch (err) {
      console.warn(`Failed to fetch "${name}":`, err);
    }
    onProgress(cachedCount + i + 1, uniqueNames.length);
    if (i < uncachedNames.length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  // Phase 2: Fetch token art for uncached cards
  const tokenUriMap = new Map<string, string>();
  for (const card of cardMap.values()) {
    if (card.all_parts) {
      for (const part of card.all_parts) {
        if (part.component === 'token' && !tokenUriMap.has(part.uri)) {
          tokenUriMap.set(part.uri, part.name);
        }
      }
    }
  }

  const tokenCache = new Map<string, FetchedTokenResult>();
  const tokenUris = Array.from(tokenUriMap.keys());
  for (let i = 0; i < tokenUris.length; i++) {
    const uri = tokenUris[i];
    // Check IndexedDB cache first
    const cached = await getCachedToken(uri);
    if (cached) {
      tokenCache.set(uri, { art: cached.art, data: cached.data });
    } else {
      const result = await fetchTokenCard(uri);
      tokenCache.set(uri, result);
      await setCachedToken(uri, result.art, result.data);
      if (i < tokenUris.length - 1) {
        await delay(REQUEST_DELAY_MS);
      }
    }
  }

  // Phase 3: Assemble results for uncached cards and write to cache
  for (const [name, card] of cardMap.entries()) {
    const tokenArt: TokenArt[] = [];
    const tokenData: ScryfallTokenData[] = [];
    if (card.all_parts) {
      for (const part of card.all_parts) {
        if (part.component === 'token') {
          const cached = tokenCache.get(part.uri);
          if (cached?.art) tokenArt.push(cached.art);
          if (cached?.data) tokenData.push(cached.data);
        }
      }
    }
    results.set(name, { card, tokenArt, tokenData });
    // Write to IndexedDB cache for future use
    await setCachedCard(name, card, tokenArt, tokenData);
  }

  // Report complete
  onProgress(uniqueNames.length, uniqueNames.length);

  return results;
}
