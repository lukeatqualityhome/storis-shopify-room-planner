// Inline SVGs for the palette fallback when a product has no image.
// Categorized by STORIS category id; everything else falls back to "generic".

const SOFA = `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" fill="#f4ede1"/><path d="M6 28 v-8 a3 3 0 0 1 3-3 h6 a3 3 0 0 1 3 3 v3 h8 v-3 a3 3 0 0 1 3-3 h6 a3 3 0 0 1 3 3 v8 z M6 28 h32 v4 H6 z" fill="#b89968"/></svg>`;
const RECLINER = `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" fill="#f4ede1"/><path d="M14 30 V14 a3 3 0 0 1 3-3 h6 a3 3 0 0 1 3 3 v3 l8 8 v5 H14 z" fill="#b89968"/></svg>`;
const BED = `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" fill="#f4ede1"/><path d="M6 30 V18 h32 V30 z M6 18 V14 h6 V18 z M32 18 V14 h6 V18 z" fill="#b89968"/><rect x="10" y="22" width="10" height="6" rx="1" fill="#fff"/><rect x="24" y="22" width="10" height="6" rx="1" fill="#fff"/></svg>`;
const TABLE = `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" fill="#f4ede1"/><rect x="6" y="18" width="32" height="4" fill="#b89968"/><rect x="9" y="22" width="3" height="12" fill="#b89968"/><rect x="32" y="22" width="3" height="12" fill="#b89968"/></svg>`;
const CHAIR = `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" fill="#f4ede1"/><path d="M16 30 V12 h12 v18 M14 24 h16 v4 H14 z M16 30 v4 M28 30 v4" stroke="#b89968" stroke-width="2.5" fill="none"/></svg>`;
const CABINET = `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" fill="#f4ede1"/><rect x="8" y="8" width="28" height="28" fill="none" stroke="#b89968" stroke-width="2.5"/><line x1="22" y1="8" x2="22" y2="36" stroke="#b89968" stroke-width="2"/><circle cx="19" cy="22" r="1.2" fill="#b89968"/><circle cx="25" cy="22" r="1.2" fill="#b89968"/></svg>`;
const DESK = `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" fill="#f4ede1"/><rect x="6" y="14" width="32" height="4" fill="#b89968"/><rect x="9" y="18" width="3" height="16" fill="#b89968"/><rect x="32" y="18" width="3" height="16" fill="#b89968"/><rect x="13" y="20" width="18" height="8" fill="none" stroke="#b89968" stroke-width="1.5"/></svg>`;
const GENERIC = `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"><rect width="44" height="44" fill="#f4ede1"/><rect x="10" y="12" width="24" height="20" rx="2" fill="none" stroke="#b89968" stroke-width="2"/><text x="22" y="27" font-family="sans-serif" font-size="12" font-weight="700" fill="#b89968" text-anchor="middle">?</text></svg>`;

const CATEGORY_TO_ICON: Record<string, string> = {
  UPHOLS: SOFA,
  LEATH: SOFA,
  LROOM: SOFA,
  RECUPH: RECLINER,
  RECLTR: RECLINER,
  BEDRM: BED,
  BFRAME: BED,
  YOUTH: BED,
  DINE: TABLE,
  OCCAS: TABLE,
  BARS: TABLE,
  ACCENT: CHAIR,
  ENTER: CABINET,
  HOMOFF: DESK,
};

export function iconDataUrlFor(category: string): string {
  const svg = CATEGORY_TO_ICON[category.toUpperCase()] ?? GENERIC;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
