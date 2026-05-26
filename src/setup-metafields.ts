import type { Config } from "./config.js";

// Ensures the three dimension metafield definitions exist on Product with Storefront read access.
// Idempotent: skips any definition that already exists.

type DefSpec = {
  key: string;
  name: string;
  description: string;
};

const DEFS: DefSpec[] = [
  { key: "width_in", name: "Width (inches)", description: "Product width in inches. Populated by STORIS sync." },
  { key: "depth_in", name: "Depth (inches)", description: "Product depth in inches. Populated by STORIS sync." },
  { key: "height_in", name: "Height (inches)", description: "Product height in inches. Populated by STORIS sync." },
];

const NAMESPACE = "custom";

type GqlResp<T> = { data?: T; errors?: Array<{ message: string }> };

const LIST_QUERY = /* GraphQL */ `
  query DefList {
    metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: "custom") {
      nodes { id namespace key name access { storefront } }
    }
  }
`;

const CREATE_MUTATION = /* GraphQL */ `
  mutation Create($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id key }
      userErrors { field message code }
    }
  }
`;

const UPDATE_ACCESS_MUTATION = /* GraphQL */ `
  mutation UpdateAccess($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition { id key access { storefront } }
      userErrors { field message code }
    }
  }
`;

export async function ensureMetafieldDefinitions(cfg: Config): Promise<{
  created: string[];
  updated: string[];
  alreadyOk: string[];
}> {
  const endpoint = `https://${cfg.shopify.storeDomain}/admin/api/${cfg.shopify.apiVersion}/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": cfg.shopify.adminToken,
  };

  async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as GqlResp<T>;
    if (body.errors && body.errors.length > 0) {
      throw new Error(`Shopify GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
    }
    if (!body.data) throw new Error("Shopify GraphQL: empty data");
    return body.data;
  }

  type Existing = {
    metafieldDefinitions: {
      nodes: Array<{
        id: string;
        namespace: string;
        key: string;
        name: string;
        access: { storefront: string | null };
      }>;
    };
  };
  const list = await gql<Existing>(LIST_QUERY);
  const existing = new Map<string, (typeof list.metafieldDefinitions.nodes)[number]>();
  for (const n of list.metafieldDefinitions.nodes) {
    if (n.namespace === NAMESPACE) existing.set(n.key, n);
  }

  const created: string[] = [];
  const updated: string[] = [];
  const alreadyOk: string[] = [];

  for (const def of DEFS) {
    const have = existing.get(def.key);
    if (!have) {
      type CreateResp = {
        metafieldDefinitionCreate: {
          createdDefinition: { id: string; key: string } | null;
          userErrors: Array<{ message: string; code: string | null }>;
        };
      };
      const resp = await gql<CreateResp>(CREATE_MUTATION, {
        definition: {
          name: def.name,
          namespace: NAMESPACE,
          key: def.key,
          description: def.description,
          type: "number_decimal",
          ownerType: "PRODUCT",
          access: { storefront: "PUBLIC_READ" },
        },
      });
      const errs = resp.metafieldDefinitionCreate.userErrors;
      if (errs.length > 0) {
        throw new Error(`metafieldDefinitionCreate ${def.key} errors: ${errs.map((e) => e.message).join("; ")}`);
      }
      created.push(def.key);
      continue;
    }
    if (have.access.storefront === "PUBLIC_READ") {
      alreadyOk.push(def.key);
      continue;
    }
    type UpdateResp = {
      metafieldDefinitionUpdate: {
        updatedDefinition: { id: string; key: string; access: { storefront: string | null } } | null;
        userErrors: Array<{ message: string; code: string | null }>;
      };
    };
    const resp = await gql<UpdateResp>(UPDATE_ACCESS_MUTATION, {
      definition: {
        namespace: NAMESPACE,
        key: def.key,
        ownerType: "PRODUCT",
        access: { storefront: "PUBLIC_READ" },
      },
    });
    const errs = resp.metafieldDefinitionUpdate.userErrors;
    if (errs.length > 0) {
      throw new Error(`metafieldDefinitionUpdate ${def.key} errors: ${errs.map((e) => e.message).join("; ")}`);
    }
    updated.push(def.key);
  }

  return { created, updated, alreadyOk };
}
