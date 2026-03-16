import type { DecklistEntry } from '../types';

const CARD_LINE_REGEX = /^(\d+)x?\s+(.+?)(?:\s+\([A-Z0-9]+\))?(?:\s+\d+)?$/;

const SECTION_HEADERS = [
  'sideboard', 'commander', 'companion', 'maybeboard',
  'deck', 'mainboard', 'main', 'land', 'creature',
  'instant', 'sorcery', 'enchantment', 'artifact', 'planeswalker',
];

export function parseMoxfieldDecklist(text: string): DecklistEntry[] {
  const lines = text.split('\n');
  const entries: DecklistEntry[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines, comments, and section headers
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    if (SECTION_HEADERS.some(h => line.toLowerCase() === h || line.toLowerCase().endsWith(':'))) continue;

    const match = line.match(CARD_LINE_REGEX);
    if (match) {
      entries.push({
        quantity: parseInt(match[1], 10),
        name: match[2].trim(),
      });
    }
  }

  return entries;
}
