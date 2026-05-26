import type { Config } from "./config.js";
import { StorisClient } from "./storis.js";
import { CsvWriter } from "./csv.js";

const HEADERS = [
  "storis_id",
  "product_description",
  "vendor_id",
  "vendor_name",
  "model_number",
  "category_id",
  "category_description",
  "width_in",
  "depth_in",
  "height_in",
] as const;

export async function exportStorisCatalog(
  cfg: Config,
  outPath: string,
  opts: { onlyPriority: boolean; limit?: number },
): Promise<{ written: number; scanned: number }> {
  const storis = new StorisClient(cfg.storis);
  const csv = new CsvWriter(outPath, HEADERS);
  const priorityLower = cfg.priorityCategories.map((c) => c.toLowerCase());

  let scanned = 0;
  let written = 0;

  for await (const p of storis.iterateProducts()) {
    scanned += 1;
    if (opts.onlyPriority) {
      const candidates = [p.categoryDescription, p.categoryId]
        .filter((s): s is string => !!s)
        .map((s) => s.toLowerCase());
      if (!candidates.some((c) => priorityLower.includes(c))) continue;
    }
    csv.writeRow([
      p.id,
      p.productDescription,
      p.vendorId,
      p.vendorName,
      p.modelNumber,
      p.categoryId,
      p.categoryDescription,
      p.width,
      p.depth,
      p.height,
    ]);
    written += 1;
    if (written % 500 === 0) {
      console.error(`[export-storis] scanned=${scanned} written=${written}`);
    }
    if (opts.limit && written >= opts.limit) break;
  }

  await csv.close();
  return { written, scanned };
}
