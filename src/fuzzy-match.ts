import { CsvWriter } from "./csv.js";
import { readCsv } from "./csv-read.js";

type StorisRow = {
  storis_id: string;
  product_description: string;
  vendor_id: string;
  vendor_name: string;
  model_number: string;
  category_id: string;
  category_description: string;
  width_in: number;
  depth_in: number;
  height_in: number;
};

type ShopifyRow = {
  shopify_gid: string;
  title: string;
  vendor: string;
  product_type: string;
  primary_sku: string;
  handle: string;
  status: string;
};

type Indexed = {
  row: ShopifyRow;
  titleTokens: Set<string>;
  vendorTokens: Set<string>;
  active: boolean;
};

// "Rare" = a token appearing in this few or fewer Shopify titles. Distinctive enough
// to act as a model-name signal rather than a category word.
const RARE_DOC_FREQ = 5;

// Canonical furniture-type tokens. A HIGH-confidence match must agree on furniture type
// when both sides declare one; otherwise the matcher would happily map a sofa to an ottoman
// because they share a brand model token.
const FURNITURE_TYPES: Record<string, string> = {
  sofa: "sofa",
  sectional: "sectional",
  loveseat: "loveseat",
  recliner: "recliner",
  rocker: "rocker",
  chair: "chair",
  ottoman: "ottoman",
  bench: "bench",
  bed: "bed",
  headboard: "bed",
  footboard: "bed",
  bedframe: "bed",
  nightstand: "nightstand",
  dresser: "dresser",
  chest: "chest",
  console: "console",
  desk: "desk",
  table: "table",
  cocktail: "table",
  hutch: "hutch",
  buffet: "buffet",
  stool: "stool",
  bookcase: "bookcase",
  cabinet: "cabinet",
  mirror: "mirror",
  bar: "bar",
  basket: "basket",
  pillow: "pillow",
  ottomanstorage: "ottoman",
};

function detectFurnitureType(tokens: Set<string>): string | null {
  // First hit wins; tokens are unordered but precedence by insertion order is fine here.
  for (const t of tokens) {
    const ft = FURNITURE_TYPES[t];
    if (ft) return ft;
  }
  return null;
}

const STOP_TOKENS = new Set([
  "the", "a", "an", "of", "and", "with", "by", "for", "in", "to", "on", "set",
  "pc", "pcs", "piece", "pieces", "size", "sizes", "color", "colors",
]);

const VENDOR_NOISE = /\b(industries|industry|inc|llc|ltd|corp|corporation|furniture|furnishings?|group|co|company|usa|america|american|the|by|design|signature|home|brand|brands|international|sleep|registered|trademark)\b/gi;
const VENDOR_TOKEN_MIN_LEN = 4;

export type FuzzyOptions = {
  storisPath: string;
  shopifyPath: string;
  outPath: string;
  minDimensions: boolean;
  topAlts: number;
};

export async function fuzzyMatch(opts: FuzzyOptions): Promise<{
  storisCount: number;
  shopifyActiveCount: number;
  high: number;
  medium: number;
  low: number;
  none: number;
}> {
  const storisRows = parseStoris(opts.storisPath);
  const shopifyRows = parseShopify(opts.shopifyPath);

  const eligibleStoris = opts.minDimensions
    ? storisRows.filter((r) => r.width_in > 0 && r.depth_in > 0)
    : storisRows;

  // Index Shopify side.
  const indexed: Indexed[] = shopifyRows.map((row) => ({
    row,
    titleTokens: tokenize(row.title),
    vendorTokens: vendorTokens(row.vendor),
    active: row.status.toUpperCase() === "ACTIVE",
  }));
  const tokenToIdx = new Map<string, number[]>();
  indexed.forEach((it, idx) => {
    for (const t of it.titleTokens) {
      let bucket = tokenToIdx.get(t);
      if (!bucket) {
        bucket = [];
        tokenToIdx.set(t, bucket);
      }
      bucket.push(idx);
    }
  });

  // IDF: how rare is each token across Shopify titles?
  const docFreq = new Map<string, number>();
  for (const [tok, bucket] of tokenToIdx) docFreq.set(tok, bucket.length);
  const isRare = (t: string) => (docFreq.get(t) ?? 0) > 0 && (docFreq.get(t) ?? 0) <= RARE_DOC_FREQ;

  // First pass: score everything in memory so we can do post-processing (collision
  // dedupe) before writing the CSV.
  type Result = {
    storis: StorisRow;
    confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
    method: string;
    matchGid: string;
    matchTitle: string;
    matchVendor: string;
    matchStatus: string;
    matchScore: number;
    alternatives: string;
  };
  const results: Result[] = [];

  for (const s of eligibleStoris) {
    const sTokens = tokenize(s.product_description);

    // Candidate set: any Shopify product sharing at least one non-stop token.
    const candIdx = new Set<number>();
    for (const t of sTokens) {
      const b = tokenToIdx.get(t);
      if (!b) continue;
      for (const i of b) candIdx.add(i);
    }
    if (candIdx.size === 0) {
      results.push(noneResult(s));
      continue;
    }

    const sFurnType = detectFurnitureType(sTokens);
    const sVendorTokens = vendorTokens(s.vendor_name);
    type Scored = {
      idx: number;
      score: number;
      vendorMatch: boolean;
      tokenOverlap: number;
      sharedRareTokens: string[];
      furnitureTypeMatch: "agree" | "disagree" | "unknown";
    };
    const scored: Scored[] = [];
    for (const idx of candIdx) {
      const cand = indexed[idx];
      if (!cand) continue;
      const overlap = intersect(sTokens, cand.titleTokens);
      const total = Math.max(sTokens.size, cand.titleTokens.size);
      if (total === 0) continue;
      const sharedRareTokens: string[] = [];
      for (const t of sTokens) if (cand.titleTokens.has(t) && isRare(t)) sharedRareTokens.push(t);
      const jaccard = overlap / total;
      const containment = overlap / Math.max(1, sTokens.size);
      // Tokenize vendor strings and require ≥1 shared significant token. Catches cases
      // like "ASHLEY FURNITURE IND." ↔ "Signature Design by Ashley®" where neither
      // string is a substring of the other but they clearly refer to the same vendor.
      let vendorMatch = false;
      for (const t of sVendorTokens) {
        if (cand.vendorTokens.has(t)) { vendorMatch = true; break; }
      }
      const cFurnType = detectFurnitureType(cand.titleTokens);
      let furnitureTypeMatch: "agree" | "disagree" | "unknown" = "unknown";
      if (sFurnType && cFurnType) furnitureTypeMatch = sFurnType === cFurnType ? "agree" : "disagree";
      // IDF-weighted score. Rare shared tokens dominate.
      const idfBoost = sharedRareTokens.reduce((acc, t) => {
        const df = docFreq.get(t) ?? 1;
        return acc + 0.45 / Math.sqrt(df);
      }, 0);
      let score = jaccard * 0.25 + containment * 0.2 + idfBoost;
      if (vendorMatch) score += 0.15;
      if (cand.active) score += 0.05;
      if (furnitureTypeMatch === "agree") score += 0.15;
      if (furnitureTypeMatch === "disagree") score -= 0.35;
      if (sTokens.size <= 1) score *= 0.5;
      scored.push({ idx, score, vendorMatch, tokenOverlap: overlap, sharedRareTokens, furnitureTypeMatch });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, opts.topAlts);
    const best = top[0];
    if (!best || best.score < 0.18) {
      results.push(noneResult(s));
      continue;
    }

    const bestIndexed = indexed[best.idx]!;
    const conf = scoreToConfidence(
      best.score,
      best.vendorMatch,
      best.tokenOverlap,
      sTokens.size,
      best.sharedRareTokens.length,
      best.furnitureTypeMatch,
    );

    const alts = top
      .slice(1)
      .map((a) => {
        const r = indexed[a.idx]!;
        return `${r.row.shopify_gid}|${a.score.toFixed(3)}|${r.row.title}`;
      })
      .join(" || ");

    results.push({
      storis: s,
      confidence: conf,
      method: describeMethod(
        best.vendorMatch,
        best.tokenOverlap,
        sTokens.size,
        best.sharedRareTokens.length,
        best.furnitureTypeMatch,
      ),
      matchGid: bestIndexed.row.shopify_gid,
      matchTitle: bestIndexed.row.title,
      matchVendor: bestIndexed.row.vendor,
      matchStatus: bestIndexed.row.status,
      matchScore: best.score,
      alternatives: alts,
    });
  }

  // Second pass: collision dedupe. If multiple STORIS rows resolve to the same Shopify
  // GID at HIGH confidence, we can't tell which is real — demote all of them.
  const highCountsByGid = new Map<string, number>();
  for (const r of results) {
    if (r.confidence === "HIGH" && r.matchGid) {
      highCountsByGid.set(r.matchGid, (highCountsByGid.get(r.matchGid) ?? 0) + 1);
    }
  }
  for (const r of results) {
    if (r.confidence === "HIGH" && r.matchGid && (highCountsByGid.get(r.matchGid) ?? 0) > 1) {
      r.confidence = "LOW";
      r.method += "+collision";
    }
  }

  // Write to CSV and tally counts.
  const csv = new CsvWriter(opts.outPath, [
    "storis_id",
    "storis_title",
    "storis_vendor",
    "storis_category",
    "storis_w_d_h",
    "confidence",
    "method",
    "match_gid",
    "match_title",
    "match_vendor",
    "match_status",
    "match_score",
    "alternatives",
  ]);
  const counts = { high: 0, medium: 0, low: 0, none: 0 };
  for (const r of results) {
    counts[r.confidence.toLowerCase() as "high" | "medium" | "low" | "none"] += 1;
    csv.writeRow([
      r.storis.storis_id,
      r.storis.product_description,
      r.storis.vendor_name,
      r.storis.category_id,
      `${r.storis.width_in}x${r.storis.depth_in}x${r.storis.height_in}`,
      r.confidence,
      r.method,
      r.matchGid,
      r.matchTitle,
      r.matchVendor,
      r.matchStatus,
      r.matchScore ? r.matchScore.toFixed(3) : "",
      r.alternatives,
    ]);
  }
  await csv.close();

  return {
    storisCount: eligibleStoris.length,
    shopifyActiveCount: indexed.filter((i) => i.active).length,
    high: counts.high,
    medium: counts.medium,
    low: counts.low,
    none: counts.none,
  };
}

function noneResult(s: StorisRow): {
  storis: StorisRow;
  confidence: "NONE";
  method: string;
  matchGid: string;
  matchTitle: string;
  matchVendor: string;
  matchStatus: string;
  matchScore: number;
  alternatives: string;
} {
  return {
    storis: s,
    confidence: "NONE",
    method: "no-candidate",
    matchGid: "",
    matchTitle: "",
    matchVendor: "",
    matchStatus: "",
    matchScore: 0,
    alternatives: "",
  };
}

function scoreToConfidence(
  score: number,
  vendorMatch: boolean,
  overlap: number,
  storisTokens: number,
  rareTokens: number,
  furnitureType: "agree" | "disagree" | "unknown",
): "HIGH" | "MEDIUM" | "LOW" {
  // Hard veto: never call it HIGH if furniture type disagrees.
  if (furnitureType === "disagree") {
    if (score >= 0.50) return "MEDIUM";
    return "LOW";
  }
  // HIGH requires rare token + (vendor match OR furniture-type agreement).
  if (rareTokens >= 1 && vendorMatch && score >= 0.55) return "HIGH";
  if (rareTokens >= 1 && furnitureType === "agree" && score >= 0.55) return "HIGH";
  if (rareTokens >= 2 && score >= 0.6) return "HIGH";
  if (rareTokens >= 1 && score >= 0.35) return "MEDIUM";
  if (vendorMatch && overlap >= Math.min(2, storisTokens) && score >= 0.30) return "MEDIUM";
  return "LOW";
}

function describeMethod(
  vendorMatch: boolean,
  overlap: number,
  storisTokens: number,
  rareTokens: number,
  furnitureType: "agree" | "disagree" | "unknown",
): string {
  const parts: string[] = [];
  if (vendorMatch) parts.push("vendor");
  if (rareTokens > 0) parts.push(`rare=${rareTokens}`);
  if (furnitureType === "agree") parts.push("ft=ok");
  if (furnitureType === "disagree") parts.push("ft=mismatch");
  parts.push(`tok=${overlap}/${storisTokens}`);
  return parts.join("+");
}

function parseStoris(path: string): StorisRow[] {
  const { rows } = readCsv(path);
  return rows.map((r) => ({
    storis_id: r[0] ?? "",
    product_description: r[1] ?? "",
    vendor_id: r[2] ?? "",
    vendor_name: r[3] ?? "",
    model_number: r[4] ?? "",
    category_id: r[5] ?? "",
    category_description: r[6] ?? "",
    width_in: Number(r[7] ?? 0),
    depth_in: Number(r[8] ?? 0),
    height_in: Number(r[9] ?? 0),
  }));
}

function parseShopify(path: string): ShopifyRow[] {
  const { rows } = readCsv(path);
  return rows.map((r) => ({
    shopify_gid: r[0] ?? "",
    title: r[1] ?? "",
    vendor: r[2] ?? "",
    product_type: r[3] ?? "",
    primary_sku: r[4] ?? "",
    handle: r[5] ?? "",
    status: r[6] ?? "",
  }));
}

function tokenize(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    // Strip " by Brand" and trailing " - SKU" suffixes that pollute matching.
    .replace(/\s+by\s+.+$/i, " ")
    .replace(/\s+-\s+[\w-]+$/i, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_TOKENS.has(t));
  return new Set(tokens);
}

function vendorTokens(v: string): Set<string> {
  const normalized = v
    .toLowerCase()
    .replace(VENDOR_NOISE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const out = new Set<string>();
  for (const tok of normalized.split(/\s+/)) {
    if (tok.length >= VENDOR_TOKEN_MIN_LEN) out.add(tok);
  }
  return out;
}

function intersect(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}
