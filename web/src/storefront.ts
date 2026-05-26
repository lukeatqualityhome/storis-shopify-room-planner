import type { CatalogProduct, MountConfig } from "./types.js";

type StorefrontResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type ProductsPage = {
  products: {
    nodes: Array<{
      id: string;
      title: string;
      handle: string;
      featuredImage: { url: string } | null;
      widthIn: { value: string } | null;
      depthIn: { value: string } | null;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
};

const PAGE_SIZE = 50;

const PRODUCTS_QUERY = /* GraphQL */ `
  query Products($cursor: String, $first: Int!) {
    products(first: $first, after: $cursor) {
      nodes {
        id
        title
        handle
        featuredImage { url(transform: { maxWidth: 200, maxHeight: 200 }) }
        widthIn: metafield(namespace: "custom", key: "width_in") { value }
        depthIn: metafield(namespace: "custom", key: "depth_in") { value }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export class StorefrontClient {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(cfg: MountConfig) {
    this.endpoint = `https://${cfg.shopDomain}/api/${cfg.apiVersion}/graphql.json`;
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Shopify-Storefront-Access-Token": cfg.storefrontToken,
    };
  }

  // Fetches one page at a time and emits products with valid width+depth metafields.
  // Caller can iterate and update the palette progressively without waiting for the
  // full catalog to load.
  async *iteratePlanReadyProducts(): AsyncGenerator<CatalogProduct[]> {
    let cursor: string | null = null;
    while (true) {
      const page = await this.fetchPage(cursor);
      const batch: CatalogProduct[] = [];
      for (const node of page.products.nodes) {
        const w = parseDecimal(node.widthIn?.value);
        const d = parseDecimal(node.depthIn?.value);
        if (w === null || d === null || w <= 0 || d <= 0) continue;
        batch.push({
          id: node.id,
          title: node.title,
          handle: node.handle,
          imageUrl: node.featuredImage?.url ?? null,
          widthIn: w,
          depthIn: d,
        });
      }
      if (batch.length > 0) yield batch;
      if (!page.products.pageInfo.hasNextPage) break;
      cursor = page.products.pageInfo.endCursor;
      if (!cursor) break;
    }
  }

  private async fetchPage(cursor: string | null): Promise<ProductsPage> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        query: PRODUCTS_QUERY,
        variables: { cursor, first: PAGE_SIZE },
      }),
    });
    if (!res.ok) {
      throw new Error(`Storefront HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as StorefrontResponse<ProductsPage>;
    if (body.errors && body.errors.length > 0) {
      throw new Error(`Storefront GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
    }
    if (!body.data) throw new Error("Storefront GraphQL: empty data");
    return body.data;
  }
}

function parseDecimal(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
