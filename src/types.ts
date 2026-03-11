export interface DecklistEntry {
  quantity: number;
  name: string;
  setCode?: string;
  collectorNumber?: string;
}

export interface ScryfallRelatedCard {
  object: string;
  id: string;
  component: string; // "token", "combo_piece", etc.
  name: string;
  type_line: string;
  uri: string;
}

export interface ScryfallCard {
  id: string;
  name: string;
  oracle_text: string;
  mana_cost: string;
  type_line: string;
  image_uris?: {
    small: string;
    normal: string;
    art_crop: string;
    png: string;
  };
  card_faces?: Array<{
    name: string;
    oracle_text: string;
    image_uris?: { small: string; normal: string; art_crop: string; png: string };
  }>;
  all_parts?: ScryfallRelatedCard[];
  colors?: string[];
  keywords?: string[];
  power?: string;
  toughness?: string;
}

export interface ScryfallTokenData {
  name: string;
  power?: string;
  toughness?: string;
  colors: string[];
  type_line: string;
  keywords: string[];
  oracle_text?: string;
  imageUrl?: string;
}

export interface TokenArt {
  name: string;
  imageUrl: string;  // art_crop
  normalUrl?: string; // full card image (normal)
  typeLine: string;
  power?: string;
  toughness?: string;
}

export interface TokenDefinition {
  count: number; // -1 for X (variable)
  power: string;
  toughness: string;
  colors: string[];
  name: string;
  types: string[];
  keywords: string[];
  rawText: string;
  condition?: string; // e.g., "6+ lands" — only created when condition is met
  isConditional?: boolean; // true if this is the conditional version
  isReplacement?: boolean; // true if this replaces the default token ("instead")
  countMode?: 'self-copies' | 'counters'; // auto-count from battlefield state
}

export interface SupportEffect {
  type: 'multiplier' | 'additional';
  factor: number;
  condition?: string;
  rawText: string;
}

export type CardCategory = 'token-generator' | 'support' | 'both' | 'other';

export interface TriggerInfo {
  type: string;
  label: string; // e.g., "Upkeep", "Tap", "Landfall", "ETB"
  alsoEtb?: boolean; // true if the ability also triggers on ETB (e.g., "enters or attacks")
}

export interface DeckCard {
  decklistEntry: DecklistEntry;
  scryfallData: ScryfallCard;
  category: CardCategory;
  tokens: TokenDefinition[];
  supportEffect?: SupportEffect;
  tokenArt: TokenArt[];
  triggerInfo?: TriggerInfo;
  hasPopulate?: boolean;
}

export interface BattlefieldCard {
  instanceId: string;
  deckCardIndex: number;
  xValue?: number; // for cards that create X tokens
  counters?: number; // +1/+1 counters (e.g., Mycoloth devour)
  conditionsMet?: Record<string, boolean>; // per-token condition toggles, keyed by token name
}

// Tokens that persist independently (from instants/sorceries)
export interface StandaloneToken {
  id: string;
  tokenDef: TokenDefinition;
  tokenArt?: TokenArt;
  finalCount: number;
  breakdown: string;
  sourceName: string; // card that created it
  copyOfDeckIndex?: number; // if this is a copy token, index into deckCards
  createdOnTurn: number;
}

export interface TokenCalculationResult {
  sourceCard: DeckCard;
  baseTokens: TokenDefinition;
  tokenArt?: TokenArt;
  activeMultipliers: Array<{
    card: DeckCard;
    effect: SupportEffect;
  }>;
  finalCount: number;
  breakdown: string;
}

export interface HistoryEntry {
  label: string;
  turn: number;
  timestamp: number;
}

export interface AppState {
  rawDecklist: string;
  deckCards: DeckCard[];
  battlefield: BattlefieldCard[];
  standaloneTokens: StandaloneToken[];
  currentTurn: number;
  pendingPopulate: number;
  pendingXTriggers: number[]; // queue of deckCardIndex values needing X input
  importStatus: 'idle' | 'parsing' | 'fetching' | 'classifying' | 'done' | 'error';
  fetchProgress: { done: number; total: number };
  error?: string;
  history: HistoryEntry[];
  undoStack: AppState[];
}
