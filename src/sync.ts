import type { Config } from "./config.js";
import { StorisClient, type StorisProduct } from "./storis.js";
import { ShopifyClient } from "./shopify.js";
import { isAtLeast, loadMapping, type Confidence, type MappingEntry } from "./mapping.js";
import { readCsv } from "./csv-read.js";

export type SyncOptions = {
  live: boolean;
  limit?: number;
  mappingPath: string;
  minConfidence: Confidence;
  // Optional path to mapping/storis-catalog.csv. When set, skip live STORIS fetch
  // and iterate the cached export instead — useful for fast re-runs.
  fromCsv?: string;
};

export type SyncStats = {
  scanned: number;
  inPriorityCategory: number;
  matched: number;
  written: number;
  skippedNoDims: number;
  skippedBelowConfidence: number;
  skippedNotInMapping: number;
  errors: number;
};

export async function runSync(cfg: Config, opts: SyncOptions): Promise<SyncStats> {
  const shopify = new ShopifyClient(cfg.shopify);
  const mapping = loadMapping(opts.mappingPath);

  const stats: SyncStats = {
    scanned: 0,
    inPriorityCategory: 0,
    matched: 0,
    written: 0,
    skippedNoDims: 0,
    skippedBelowConfidence: 0,
    skippedNotInMapping: 0,
    errors: 0,
  };

  const mode = opts.live ? "LIVE" : "DRY-RUN";
  const priorityLower = cfg.priorityCategories.map((c) => c.toLowerCase());
  const source = opts.fromCsv ? `csv:${opts.fromCsv}` : "storis-api";
  console.log(
    `[${mode}] mapping=${opts.mappingPath} entries=${mapping.size} ` +
      `minConfidence=${opts.minConfidence} source=${source}`,
  );
  console.log(`[${mode}] categories: ${cfg.priorityCategories.join(", ")}`);

  const iterator = opts.fromCsv
    ? iterateFromCsv(opts.fromCsv)
    : new StorisClient(cfg.storis).iterateProducts();

  for await (const product of iterator) {
    stats.scanned += 1;
    if (opts.limit && stats.matched >= opts.limit) break;

    if (!matchesPriority(product, priorityLower)) continue;
    stats.inPriorityCategory += 1;

    if (!hasUsableDimensions(product)) {
      stats.skippedNoDims += 1;
      continue;
    }

    const entry: MappingEntry | undefined = mapping.get(product.id);
    if (!entry) {
      stats.skippedNotInMapping += 1;
      continue;
    }
    if (!isAtLeast(entry.confidence, opts.minConfidence)) {
      stats.skippedBelowConfidence += 1;
      continue;
    }
    stats.matched += 1;

    console.log(
      `[${mode}] storisId=${product.id} (${product.productDescription}) ` +
        `-> ${entry.shopifyGid} (${entry.shopifyTitle}) ` +
        `w=${product.width} d=${product.depth} h=${product.height} conf=${entry.confidence}`,
    );

    if (!opts.live) continue;

    try {
      await shopify.setDimensionMetafields({
        ownerId: entry.shopifyGid,
        widthIn: product.width,
        depthIn: product.depth,
        heightIn: product.height,
      });
      stats.written += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(`[${mode}] storisId=${product.id} write failed:`, err);
    }
  }

  return stats;
}

function matchesPriority(p: StorisProduct, priorityLower: string[]): boolean {
  const candidates = [p.categoryDescription, p.categoryId]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  return candidates.some((c) => priorityLower.includes(c));
}

function hasUsableDimensions(p: StorisProduct): boolean {
  // Need both width and depth > 0 to be useful in the room planner.
  return (p.width ?? 0) > 0 && (p.depth ?? 0) > 0;
}

async function* iterateFromCsv(path: string): AsyncGenerator<StorisProduct> {
  const { headers, rows } = readCsv(path);
  const col = (name: string): number => headers.indexOf(name);
  const cId = col("storis_id");
  const cDesc = col("product_description");
  const cVid = col("vendor_id");
  const cVn = col("vendor_name");
  const cMn = col("model_number");
  const cCid = col("category_id");
  const cCd = col("category_description");
  const cW = col("width_in");
  const cD = col("depth_in");
  const cH = col("height_in");
  for (const r of rows) {
    yield {
      id: r[cId] ?? "",
      productDescription: r[cDesc] ?? null,
      categoryId: r[cCid] ?? null,
      categoryDescription: r[cCd] ?? null,
      vendorId: r[cVid] ?? null,
      vendorName: r[cVn] ?? null,
      modelNumber: r[cMn] ?? null,
      width: Number(r[cW] ?? 0) || null,
      depth: Number(r[cD] ?? 0) || null,
      height: Number(r[cH] ?? 0) || null,
    };
  }
}
