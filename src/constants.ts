export const CATEGORY_LABELS: Record<string, string> = {
  'token-generator': 'Token Generator',
  'support': 'Support',
  'both': 'Generator + Support',
  'other': '',
};

export const CATEGORY_COLORS: Record<string, string> = {
  'token-generator': '#4caf50',
  'support': '#ff9800',
  'both': '#9c27b0',
  'other': 'transparent',
};

export const TRIGGER_COLORS: Record<string, string> = {
  'landfall': '#16a34a',
  'upkeep': '#2563eb',
  'combat': '#dc2626',
  'etb': '#d97706',
  'tap': '#6366f1',
  'other': '#6b7280',
};

export const COLOR_BORDER_MAP: Record<string, string> = {
  white: '#f5f0d0',
  blue: '#0e67ab',
  black: '#6b6b6b',
  red: '#d32029',
  green: '#00733e',
};

export const TRIGGER_GROUP_ORDER = ['etb', 'landfall', 'upkeep', 'combat', 'tap', 'other'];

export const TRIGGER_GROUP_LABELS: Record<string, string> = {
  etb: 'ETB',
  landfall: 'Landfall',
  upkeep: 'Upkeep',
  combat: 'Combat',
  tap: 'Tap',
  other: 'Other Triggers',
  support: 'Support',
  none: 'No Trigger',
};
