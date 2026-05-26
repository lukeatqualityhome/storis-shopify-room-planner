import { loadConfig } from "./config.js";
import { runSync } from "./sync.js";
import { discoverCategories } from "./discover.js";
import { exportStorisCatalog } from "./export-storis.js";
import { exportShopifyCatalog } from "./export-shopify.js";
import { fuzzyMatch } from "./fuzzy-match.js";
import { ensureMetafieldDefinitions } from "./setup-metafields.js";
import { exportPlannerCatalog } from "./export-planner-catalog.js";
import type { Confidence } from "./mapping.js";

type Args = {
  mode: "sync" | "discover" | "export-storis" | "export-shopify" | "fuzzy-match" | "setup-metafields" | "export-planner-catalog";
  live: boolean;
  limit?: number;
  top: number;
  out: string;
  onlyPriority: boolean;
  mappingPath: string;
  minConfidence: Confidence;
  minScore: number;
  fromCsv?: string;
};

function parseArgs(argv: string[]): Args {
  const tokens = argv.slice(2);
  const flags = new Set<string>();
  let limit: number | undefined;
  let top = 50;
  let out = "";
  let mappingPath = "mapping/draft-mapping.csv";
  let minConfidence: Confidence = "HIGH";
  let minScore = 0;
  let fromCsv: string | undefined;
  for (const a of tokens) {
    const m = /^([^=]+)=(.+)$/.exec(a);
    if (m) {
      if (m[1] === "--limit") limit = Number(m[2]);
      else if (m[1] === "--top") top = Number(m[2]);
      else if (m[1] === "--out") out = m[2] ?? "";
      else if (m[1] === "--mapping") mappingPath = m[2] ?? mappingPath;
      else if (m[1] === "--from-csv") fromCsv = m[2] ?? "mapping/storis-catalog.csv";
      else if (m[1] === "--min-confidence") {
        const v = (m[2] ?? "HIGH").toUpperCase();
        if (v !== "HIGH" && v !== "MEDIUM" && v !== "LOW") {
          throw new Error(`--min-confidence must be HIGH|MEDIUM|LOW, got ${v}`);
        }
        minConfidence = v as Confidence;
      } else if (m[1] === "--min-score") {
        const n = Number(m[2]);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`--min-score must be a non-negative number, got ${m[2]}`);
        }
        minScore = n;
      } else flags.add(a);
    } else {
      flags.add(a);
    }
  }
  let mode: Args["mode"] = "sync";
  if (flags.has("--discover-categories")) mode = "discover";
  else if (flags.has("--export-storis")) mode = "export-storis";
  else if (flags.has("--export-shopify")) mode = "export-shopify";
  else if (flags.has("--fuzzy-match")) mode = "fuzzy-match";
  else if (flags.has("--setup-metafields")) mode = "setup-metafields";
  else if (flags.has("--export-planner-catalog")) mode = "export-planner-catalog";
  return {
    mode,
    live: flags.has("--live"),
    limit,
    top,
    out,
    onlyPriority: !flags.has("--all"),
    mappingPath,
    minConfidence,
    minScore,
    fromCsv: flags.has("--from-csv") ? "mapping/storis-catalog.csv" : fromCsv,
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const args = parseArgs(process.argv);

  if (args.mode === "discover") {
    await discoverCategories(cfg, { limit: args.limit, top: args.top });
    return;
  }
  if (args.mode === "export-storis") {
    const out = args.out || "mapping/storis-catalog.csv";
    const r = await exportStorisCatalog(cfg, out, {
      onlyPriority: args.onlyPriority,
      limit: args.limit,
    });
    console.log(`[export-storis] done. scanned=${r.scanned} written=${r.written} -> ${out}`);
    return;
  }
  if (args.mode === "export-shopify") {
    const out = args.out || "mapping/shopify-catalog.csv";
    const r = await exportShopifyCatalog(cfg, out);
    console.log(`[export-shopify] done. written=${r.written} -> ${out}`);
    return;
  }
  if (args.mode === "fuzzy-match") {
    const out = args.out || "mapping/draft-mapping.csv";
    const r = await fuzzyMatch({
      storisPath: "mapping/storis-catalog.csv",
      shopifyPath: "mapping/shopify-catalog.csv",
      outPath: out,
      minDimensions: true,
      topAlts: 4,
    });
    console.log(
      `[fuzzy-match] storis=${r.storisCount} shopifyActive=${r.shopifyActiveCount} ` +
        `HIGH=${r.high} MEDIUM=${r.medium} LOW=${r.low} NONE=${r.none} -> ${out}`,
    );
    return;
  }
  if (args.mode === "export-planner-catalog") {
    const out = args.out || "web/public/room-planner-catalog.json";
    const r = await exportPlannerCatalog(cfg, { outPath: out, withImages: true });
    console.log(
      `[export-planner-catalog] done. catalog=${r.written} withImages=${r.withImages} -> ${out}`,
    );
    return;
  }
  if (args.mode === "setup-metafields") {
    const r = await ensureMetafieldDefinitions(cfg);
    console.log(
      `[setup-metafields] created=[${r.created.join(", ")}] ` +
        `updated=[${r.updated.join(", ")}] alreadyOk=[${r.alreadyOk.join(", ")}]`,
    );
    return;
  }

  const stats = await runSync(cfg, {
    live: args.live,
    limit: args.limit,
    mappingPath: args.mappingPath,
    minConfidence: args.minConfidence,
    minScore: args.minScore,
    fromCsv: args.fromCsv,
  });
  console.log("---");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
