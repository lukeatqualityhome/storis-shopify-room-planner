import { readCsv } from "./csv-read.js";

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type MappingEntry = {
  storisId: string;
  shopifyGid: string;
  shopifyTitle: string;
  confidence: Confidence;
  score: number;
};

const CONFIDENCE_ORDER: Confidence[] = ["LOW", "MEDIUM", "HIGH"];

export function isAtLeast(have: Confidence, min: Confidence): boolean {
  return CONFIDENCE_ORDER.indexOf(have) >= CONFIDENCE_ORDER.indexOf(min);
}

export function loadMapping(path: string): Map<string, MappingEntry> {
  const { headers, rows } = readCsv(path);
  const idx = (name: string): number => headers.indexOf(name);
  const cStoris = idx("storis_id");
  const cGid = idx("match_gid");
  const cTitle = idx("match_title");
  const cConf = idx("confidence");
  const cScore = idx("match_score");
  if (cStoris < 0 || cGid < 0 || cConf < 0) {
    throw new Error(
      `Mapping CSV ${path} missing required columns. Got headers: ${headers.join(", ")}`,
    );
  }
  const map = new Map<string, MappingEntry>();
  for (const r of rows) {
    const storisId = r[cStoris] ?? "";
    const shopifyGid = r[cGid] ?? "";
    const confidence = ((r[cConf] ?? "NONE") as Confidence) || "NONE";
    if (!storisId || !shopifyGid || confidence === "NONE") continue;
    map.set(storisId, {
      storisId,
      shopifyGid,
      shopifyTitle: cTitle >= 0 ? (r[cTitle] ?? "") : "",
      confidence,
      score: cScore >= 0 ? Number(r[cScore] ?? 0) : 0,
    });
  }
  return map;
}
