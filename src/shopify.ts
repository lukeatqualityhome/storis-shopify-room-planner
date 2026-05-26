import type { Config } from "./config.js";

export type ShopifyProductRef = {
  id: string; // gid://shopify/Product/123
  sku: string;
};

export type MetafieldInput = {
  ownerId: string;
  widthIn: number | null;
  depthIn: number | null;
  heightIn: number | null;
};

const METAFIELD_NAMESPACE = "custom";

export class ShopifyClient {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(cfg: Config["shopify"]) {
    this.endpoint = `https://${cfg.storeDomain}/admin/api/${cfg.apiVersion}/graphql.json`;
    this.headers = {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": cfg.adminToken,
    };
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { data?: T; errors?: unknown[] };
    if (body.errors && body.errors.length > 0) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors)}`);
    }
    if (!body.data) throw new Error("Shopify GraphQL: empty data");
    return body.data;
  }

  // Look up a product by SKU via variant search, returning the parent product id.
  async findProductBySku(sku: string): Promise<ShopifyProductRef | null> {
    const query = /* GraphQL */ `
      query ProductBySku($q: String!) {
        productVariants(first: 1, query: $q) {
          edges {
            node {
              sku
              product { id }
            }
          }
        }
      }
    `;
    const data = await this.graphql<{
      productVariants: { edges: { node: { sku: string | null; product: { id: string } } }[] };
    }>(query, { q: `sku:${escapeQuery(sku)}` });
    const edge = data.productVariants.edges[0];
    if (!edge) return null;
    return { id: edge.node.product.id, sku };
  }

  async setDimensionMetafields(input: MetafieldInput): Promise<void> {
    const metafields = [
      buildMetafield(input.ownerId, "width_in", input.widthIn),
      buildMetafield(input.ownerId, "depth_in", input.depthIn),
      buildMetafield(input.ownerId, "height_in", input.heightIn),
    ].filter((m): m is NonNullable<typeof m> => m !== null);

    if (metafields.length === 0) return;

    const mutation = /* GraphQL */ `
      mutation SetDims($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message code }
        }
      }
    `;
    const data = await this.graphql<{ metafieldsSet: { userErrors: { message: string }[] } }>(mutation, {
      metafields,
    });
    const errs = data.metafieldsSet.userErrors;
    if (errs.length > 0) {
      throw new Error(`metafieldsSet userErrors: ${errs.map((e) => e.message).join("; ")}`);
    }
  }
}

function buildMetafield(ownerId: string, key: string, value: number | null) {
  if (value === null) return null;
  return {
    ownerId,
    namespace: METAFIELD_NAMESPACE,
    key,
    type: "number_decimal",
    value: String(value),
  };
}

function escapeQuery(s: string): string {
  return s.replace(/(["\\])/g, "\\$1");
}
