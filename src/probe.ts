// One-off diagnostic: dump full Detail payload for a handful of STORIS products so we can
// see every field that might bridge to a Shopify SKU (alternateProductId, vendorUPC, etc.).
// Usage: npx tsx src/probe.ts
import { loadConfig } from "./config.js";
import { StorisClient } from "./storis.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const storis = new StorisClient(cfg.storis);

  // Pull the first 10 product IDs of the catalog via the Changes job, then fetch their
  // full detail and dump raw JSON.
  const jobId = await storis.startChangesJob();
  const job = await storis.waitForJob(jobId);
  console.error(`[probe] job complete, ${job.numberOfProducts} products total`);
  const firstPage = await storis.fetchChunkPage(jobId, 1);
  const sampleIds = firstPage.slice(0, 10);
  console.error(`[probe] sampling ids: ${sampleIds.join(", ")}`);

  // Bypass the normalizer — go direct to the raw payload via a one-off authedGet.
  // We need raw JSON to see fields the normalizer drops.
  const token = await (storis as unknown as { getToken(): Promise<string> }).getToken();
  const baseUrl = cfg.storis.baseUrl;
  const qs = sampleIds.map((id) => `ProductIds=${encodeURIComponent(id)}`).join("&");
  const res = await fetch(`${baseUrl}/api/Products/Detail?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
