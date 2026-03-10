import type { ScryfallCard, TokenArt } from '../types';

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

async function fetchTokenArt(uri: string): Promise<TokenArt | null> {
  try {
    const res = await fetchWithTimeout(uri);
    if (!res.ok) return null;
    const data: ScryfallCard = await res.json();
    const imageUrl = data.image_uris?.art_crop
      || data.card_faces?.[0]?.image_uris?.art_crop
      || data.image_uris?.normal
      || data.card_faces?.[0]?.image_uris?.normal;
    if (!imageUrl) return null;

    // Token cards in Scryfall have power/toughness as top-level fields
    // but our type doesn't include them, so extract from the raw JSON
    const raw = data as unknown as Record<string, string>;

    return {
      name: data.name,
      imageUrl,
      typeLine: data.type_line,
      power: raw.power || undefined,
      toughness: raw.toughness || undefined,
    };
  } catch {
    return null;
  }
}

export async function fetchAllCards(
  cardNames: string[],
  onProgress: (done: number, total: number) => void
): Promise<Map<string, { card: ScryfallCard; tokenArt: TokenArt[] }>> {
  const results = new Map<string, { card: ScryfallCard; tokenArt: TokenArt[] }>();
  const uniqueNames = [...new Set(cardNames)];

  // Phase 1: Fetch all cards
  const cardMap = new Map<string, ScryfallCard>();
  for (let i = 0; i < uniqueNames.length; i++) {
    const name = uniqueNames[i];
    try {
      const card = await fetchCard(name);
      cardMap.set(name, card);
    } catch (err) {
      console.warn(`Failed to fetch "${name}":`, err);
    }
    onProgress(i + 1, uniqueNames.length);
    if (i < uniqueNames.length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  // Phase 2: Fetch token art for cards that have related tokens
  // Collect all unique token URIs first
  const tokenUriMap = new Map<string, string>(); // uri -> token name
  for (const card of cardMap.values()) {
    if (card.all_parts) {
      for (const part of card.all_parts) {
        if (part.component === 'token' && !tokenUriMap.has(part.uri)) {
          tokenUriMap.set(part.uri, part.name);
        }
      }
    }
  }

  // Fetch all token art
  const tokenArtCache = new Map<string, TokenArt>();
  const tokenUris = Array.from(tokenUriMap.keys());
  for (let i = 0; i < tokenUris.length; i++) {
    const uri = tokenUris[i];
    const art = await fetchTokenArt(uri);
    if (art) {
      tokenArtCache.set(uri, art);
    }
    if (i < tokenUris.length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  // Phase 3: Assemble results
  for (const [name, card] of cardMap.entries()) {
    const tokenArt: TokenArt[] = [];
    if (card.all_parts) {
      for (const part of card.all_parts) {
        if (part.component === 'token') {
          const art = tokenArtCache.get(part.uri);
          if (art) tokenArt.push(art);
        }
      }
    }
    results.set(name, { card, tokenArt });
  }

  return results;
}
