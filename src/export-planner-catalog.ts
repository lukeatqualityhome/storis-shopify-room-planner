import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "./config.js";
import { readCsv } from "./csv-read.js";

// Output schema, consumed by web/src/catalog.ts. Keep this stable across versions.
type CatalogEntry = {
  id: string;            // STORIS product id
  title: string;         // Cleaned-up display title
  widthIn: number;
  depthIn: number;
  heightIn: number | null;
  category: string;      // STORIS categoryId (for icon selection)
  imageUrl: string | null;
};

type Manifest = {
  generatedAt: string;
  count: number;
  catalog: CatalogEntry[];
};

// Minimal Shopify image lookup. We map a Shopify GID -> image URL by fetching
// the Storefront catalog's featuredImage. The export-shopify CSV doesn't carry
// images, so we hit Admin GraphQL one paginated time here.
type ImageMap = Map<string, string>;

const STORIS_CSV = "mapping/storis-catalog.csv";
const MAPPING_CSV = "mapping/draft-mapping.csv";

export type ExportCatalogOptions = {
  outPath: string;
  // When true, also fetch Shopify images for matched products. Adds ~30s.
  withImages: boolean;
};

export async function exportPlannerCatalog(
  cfg: Config,
  opts: ExportCatalogOptions,
): Promise<{ written: number; withImages: number }> {
  const storisRows = parseStoris(STORIS_CSV);
  const mapping = parseMapping(MAPPING_CSV);

  let imageMap: ImageMap = new Map();
  if (opts.withImages && mapping.size > 0) {
    console.error(`[catalog] fetching Shopify images for ${mapping.size} matched products...`);
    imageMap = await fetchShopifyImages(cfg, [...new Set([...mapping.values()].map((e) => e.shopifyGid))]);
  }

  const catalog: CatalogEntry[] = [];
  for (const s of storisRows) {
    if (s.widthIn <= 0 || s.depthIn <= 0) continue;
    const mapped = mapping.get(s.storisId);
    const imageUrl = mapped ? imageMap.get(mapped.shopifyGid) ?? null : null;
    catalog.push({
      id: s.storisId,
      title: prettifyTitle(s.productDescription),
      widthIn: s.widthIn,
      depthIn: s.depthIn,
      heightIn: s.heightIn > 0 ? s.heightIn : null,
      category: s.categoryId,
      imageUrl,
    });
  }
  // Sort: imaged first (better palette UX), then by title.
  catalog.sort((a, b) => {
    if (!!a.imageUrl !== !!b.imageUrl) return a.imageUrl ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    count: catalog.length,
    catalog,
  };
  await mkdir(dirname(opts.outPath), { recursive: true });
  await writeFile(opts.outPath, JSON.stringify(manifest), "utf8");
  return { written: catalog.length, withImages: catalog.filter((c) => c.imageUrl).length };
}

type StorisRow = {
  storisId: string;
  productDescription: string;
  categoryId: string;
  widthIn: number;
  depthIn: number;
  heightIn: number;
};

function parseStoris(path: string): StorisRow[] {
  const { headers, rows } = readCsv(path);
  const i = (n: string): number => headers.indexOf(n);
  const cId = i("storis_id");
  const cDesc = i("product_description");
  const cCat = i("category_id");
  const cW = i("width_in");
  const cD = i("depth_in");
  const cH = i("height_in");
  return rows.map((r) => ({
    storisId: r[cId] ?? "",
    productDescription: r[cDesc] ?? "",
    categoryId: r[cCat] ?? "",
    widthIn: Number(r[cW] ?? 0),
    depthIn: Number(r[cD] ?? 0),
    heightIn: Number(r[cH] ?? 0),
  }));
}

type MappingEntry = { shopifyGid: string };
function parseMapping(path: string): Map<string, MappingEntry> {
  const map = new Map<string, MappingEntry>();
  try {
    const { headers, rows } = readCsv(path);
    const cStoris = headers.indexOf("storis_id");
    const cGid = headers.indexOf("match_gid");
    const cConf = headers.indexOf("confidence");
    const cScore = headers.indexOf("match_score");
    for (const r of rows) {
      const conf = r[cConf] ?? "";
      const score = Number(r[cScore] ?? 0);
      // Mirror the live-sync defaults: HIGH always, MEDIUM with score >= 0.7.
      const eligible = conf === "HIGH" || (conf === "MEDIUM" && score >= 0.7);
      if (!eligible) continue;
      const id = r[cStoris] ?? "";
      const gid = r[cGid] ?? "";
      if (id && gid) map.set(id, { shopifyGid: gid });
    }
  } catch (err) {
    console.error(`[catalog] mapping CSV missing or unreadable, no images will be attached: ${err}`);
  }
  return map;
}

const TITLE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bPWR\b/gi, "Power"],
  [/\bREC\b/gi, "Reclining"],
  [/\bCON\b/gi, "Console"],
  [/\bHDRST\b/gi, "Headrest"],
  [/\bADJ\b/gi, "Adjustable"],
  [/\bUPH\b/gi, "Upholstered"],
  [/\bHDBD\b/gi, "Headboard"],
  [/\bFTBD\b/gi, "Footboard"],
  [/\bRAF\b/gi, "Right-Arm-Facing"],
  [/\bLAF\b/gi, "Left-Arm-Facing"],
  [/\bSD\b/gi, ""],
  [/\bSO\b/gi, ""],
];

function prettifyTitle(raw: string): string {
  let s = raw.trim();
  if (!s) return "(unnamed)";
  // Expand common STORIS abbreviations.
  for (const [re, sub] of TITLE_REPLACEMENTS) s = s.replace(re, sub);
  // Collapse internal slashes (used by STORIS as a separator) to spaces.
  s = s.replace(/\s*\/\s*/g, " ");
  // Collapse multiple spaces.
  s = s.replace(/\s{2,}/g, " ").trim();
  // If the title is all-caps, convert to Title Case.
  if (/^[^a-z]*$/.test(s)) {
    s = s
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return s;
}

// Fetch featuredImage URLs for a batch of Shopify product GIDs via Admin GraphQL.
// Uses Admin API token (already configured); Storefront isn't required.
async function fetchShopifyImages(cfg: Config, gids: string[]): Promise<ImageMap> {
  const endpoint = `https://${cfg.shopify.storeDomain}/admin/api/${cfg.shopify.apiVersion}/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": cfg.shopify.adminToken,
  };
  const map: ImageMap = new Map();
  const BATCH = 50;
  for (let i = 0; i < gids.length; i += BATCH) {
    const batch = gids.slice(i, i + BATCH);
    const query = /* GraphQL */ `
      query Imgs($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id featuredImage { url(transform: { maxWidth: 200, maxHeight: 200 }) } }
        }
      }
    `;
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables: { ids: batch } }),
    });
    if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      data?: { nodes: Array<{ id: string; featuredImage: { url: string } | null } | null> };
      errors?: Array<{ message: string }>;
    };
    if (body.errors && body.errors.length > 0) {
      throw new Error(`Shopify GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
    }
    for (const n of body.data?.nodes ?? []) {
      if (n?.featuredImage?.url) map.set(n.id, n.featuredImage.url);
    }
    // Light delay to be polite to the GraphQL rate limit.
    await new Promise((r) => setTimeout(r, 200));
  }
  return map;
}
