import type { Config } from "./config.js";
import { StorisClient } from "./storis.js";

export type DiscoverOptions = {
  limit?: number;
  top: number;
};

type Row = {
  categoryId: string | null;
  categoryDescription: string | null;
  count: number;
  withDims: number;
};

export async function discoverCategories(cfg: Config, opts: DiscoverOptions): Promise<void> {
  const storis = new StorisClient(cfg.storis);
  const counts = new Map<string, Row>();
  let scanned = 0;
  let interrupted = false;

  const handleInterrupt = () => {
    interrupted = true;
    console.error("\n[discover] received SIGINT, printing partial results…");
  };
  process.once("SIGINT", handleInterrupt);

  try {
    for await (const product of storis.iterateProducts()) {
      scanned += 1;
      const key = `${product.categoryId ?? ""}${product.categoryDescription ?? ""}`;
      const hasDims =
        product.width !== null || product.depth !== null || product.height !== null;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
        if (hasDims) existing.withDims += 1;
      } else {
        counts.set(key, {
          categoryId: product.categoryId,
          categoryDescription: product.categoryDescription,
          count: 1,
          withDims: hasDims ? 1 : 0,
        });
      }
      if (scanned % 500 === 0) {
        console.error(
          `[discover] scanned=${scanned} uniqueCategories=${counts.size}`,
        );
      }
      if (interrupted) break;
      if (opts.limit && scanned >= opts.limit) break;
    }
  } finally {
    process.off("SIGINT", handleInterrupt);
  }

  console.error(
    `\n[discover] complete. scanned=${scanned} uniqueCategories=${counts.size}`,
  );
  printTop(counts, opts.top);
}

function printTop(counts: Map<string, Row>, top: number): void {
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
  // Tab-separated so it pastes cleanly into a spreadsheet.
  console.log("count\twithDims\tcategoryId\tcategoryDescription");
  for (const row of sorted.slice(0, top)) {
    console.log(
      `${row.count}\t${row.withDims}\t${row.categoryId ?? "(none)"}\t${row.categoryDescription ?? "(none)"}`,
    );
  }
  if (sorted.length > top) {
    console.log(`... and ${sorted.length - top} more (raise --top= to see more)`);
  }
}
