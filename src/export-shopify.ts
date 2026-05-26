import type { Config } from "./config.js";
import { CsvWriter } from "./csv.js";

const HEADERS = [
  "shopify_gid",
  "title",
  "vendor",
  "product_type",
  "primary_sku",
  "handle",
  "status",
  "has_dimension_metafields",
] as const;

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  vendor: string | null;
  productType: string | null;
  status: string | null;
  variants: { edges: { node: { sku: string | null } }[] };
  widthIn: { value: string } | null;
  widthInches: { value: string } | null;
};

type Page = {
  products: {
    nodes: ProductNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const PRODUCTS_QUERY = /* GraphQL */ `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      nodes {
        id
        title
        handle
        vendor
        productType
        status
        variants(first: 1) { edges { node { sku } } }
        widthIn: metafield(namespace: "custom", key: "width_in") { value }
        widthInches: metafield(namespace: "custom", key: "width_inches") { value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type GqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: {
    cost?: {
      throttleStatus?: { currentlyAvailable: number; restoreRate: number };
    };
  };
};

async function gqlWithRetry<T>(
  endpoint: string,
  headers: Record<string, string>,
  variables: Record<string, unknown>,
): Promise<GqlResponse<T>> {
  let attempt = 0;
  while (true) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: PRODUCTS_QUERY, variables }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429 && attempt < 6) {
        const wait = 1000 * 2 ** attempt;
        console.error(`[export-shopify] HTTP 429, sleeping ${wait}ms`);
        await sleep(wait);
        attempt += 1;
        continue;
      }
      throw new Error(`Shopify HTTP ${res.status}: ${text}`);
    }
    const body = (await res.json()) as GqlResponse<T>;
    const throttled = body.errors?.some(
      (e) => e.extensions?.code === "THROTTLED" || /throttled/i.test(e.message),
    );
    if (throttled && attempt < 6) {
      const status = body.extensions?.cost?.throttleStatus;
      const restoreRate = status?.restoreRate ?? 50;
      const recommendedWait = Math.max(1000, Math.ceil((1000 / restoreRate) * 1000));
      const wait = Math.max(recommendedWait, 1000 * 2 ** attempt);
      console.error(`[export-shopify] throttled, sleeping ${wait}ms (attempt ${attempt + 1})`);
      await sleep(wait);
      attempt += 1;
      continue;
    }
    return body;
  }
}

export async function exportShopifyCatalog(
  cfg: Config,
  outPath: string,
): Promise<{ written: number }> {
  const endpoint = `https://${cfg.shopify.storeDomain}/admin/api/${cfg.shopify.apiVersion}/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": cfg.shopify.adminToken,
  };
  const csv = new CsvWriter(outPath, HEADERS);
  let cursor: string | null = null;
  let written = 0;

  while (true) {
    const resp: GqlResponse<Page> = await gqlWithRetry<Page>(endpoint, headers, { cursor });
    if (resp.errors && resp.errors.length > 0) {
      throw new Error(`Shopify GraphQL: ${resp.errors.map((e) => e.message).join("; ")}`);
    }
    const page = resp.data?.products;
    if (!page) throw new Error("Shopify GraphQL: empty data");

    for (const node of page.nodes) {
      const primarySku = node.variants.edges[0]?.node.sku ?? null;
      const hasDims = !!(node.widthIn?.value || node.widthInches?.value);
      csv.writeRow([
        node.id,
        node.title,
        node.vendor,
        node.productType,
        primarySku,
        node.handle,
        node.status,
        hasDims ? "1" : "0",
      ]);
      written += 1;
    }
    if (written % 500 === 0 || !page.pageInfo.hasNextPage) {
      console.error(`[export-shopify] written=${written}`);
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    if (!cursor) break;
    // Gentle baseline delay to spread load and avoid hitting the bucket cap.
    await sleep(250);
  }

  await csv.close();
  return { written };
}
