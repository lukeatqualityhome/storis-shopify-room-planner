import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  STORIS_BASE_URL: z.string().url(),
  STORIS_CLIENT_ID: z.string().min(1),
  STORIS_CLIENT_SECRET: z.string().min(1),

  SHOPIFY_STORE_DOMAIN: z.string().regex(/\.myshopify\.com$/, "must end in .myshopify.com"),
  SHOPIFY_ADMIN_TOKEN: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().default("2025-01"),

  PRIORITY_CATEGORIES: z.string().optional(),
});

// STORIS category IDs covering the room-planner-relevant catalog (~21.7k products
// out of 26.5k). Matched case-insensitively against ProductData.category.categoryId
// in src/sync.ts. Confirmed by the discovery scan on 2026-05-25.
const DEFAULT_PRIORITY_CATEGORIES = [
  "UPHOLS",   // UPHOLSTERY — sofas, loveseats, sectionals (~4,524)
  "BEDRM",    // BEDROOM FURNITURE — beds, dressers, nightstands (~4,718)
  "DEF",      // DEFAULT CATEGORY — mis-categorized real furniture (~4,903, 86% have dims)
  "DINE",     // DINING — tables, chairs, hutches (~1,642)
  "ACCENT",   // ACCENTS — accent chairs, accent tables (~1,526)
  "RECUPH",   // RECLINE UPHOLSTERY (~1,415)
  "OCCAS",    // OCCASIONAL — coffee + end tables (~903)
  "ENTER",    // ENTERTAINMENT CENTERS & CONSOLS (~462)
  "YOUTH",    // YOUTH furniture (~364)
  "HOMOFF",   // HOME OFFICE — desks (~317)
  "LEATH",    // LEATHER (sofas) (~131)
  "RECLTR",   // RECLINE LEATHER (~106)
  "BFRAME",   // BED FRAMES (~49)
  "BARS",     // BARS (~49)
  "LROOM",    // LIVING ROOM UPHOLSTERY (~9)
];

export type Config = {
  storis: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
  };
  shopify: {
    storeDomain: string;
    adminToken: string;
    apiVersion: string;
  };
  priorityCategories: string[];
};

export function loadConfig(): Config {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment. Check .env against .env.example:\n${issues}`);
  }
  const env = parsed.data;
  return {
    storis: {
      baseUrl: env.STORIS_BASE_URL.replace(/\/$/, ""),
      clientId: env.STORIS_CLIENT_ID,
      clientSecret: env.STORIS_CLIENT_SECRET,
    },
    shopify: {
      storeDomain: env.SHOPIFY_STORE_DOMAIN,
      adminToken: env.SHOPIFY_ADMIN_TOKEN,
      apiVersion: env.SHOPIFY_API_VERSION,
    },
    priorityCategories: env.PRIORITY_CATEGORIES
      ? env.PRIORITY_CATEGORIES.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_PRIORITY_CATEGORIES,
  };
}
