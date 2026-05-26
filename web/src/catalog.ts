import type { CatalogProduct, MountConfig } from "./types.js";

type CatalogManifest = {
  generatedAt?: string;
  count?: number;
  catalog: Array<{
    id: string;
    title: string;
    widthIn: number;
    depthIn: number;
    heightIn?: number | null;
    category?: string;
    imageUrl?: string | null;
  }>;
};

export class CatalogClient {
  constructor(private readonly cfg: MountConfig) {}

  async load(): Promise<CatalogProduct[]> {
    const res = await fetch(this.cfg.catalogUrl, { credentials: "omit" });
    if (!res.ok) {
      throw new Error(`Catalog fetch failed: ${res.status} ${this.cfg.catalogUrl}`);
    }
    const body = (await res.json()) as CatalogManifest;
    if (!Array.isArray(body.catalog)) throw new Error("Catalog payload missing 'catalog' array");
    return body.catalog
      .filter((c) => c && c.widthIn > 0 && c.depthIn > 0)
      .map((c) => ({
        id: c.id,
        title: c.title,
        imageUrl: c.imageUrl ?? null,
        category: c.category ?? "",
        widthIn: c.widthIn,
        depthIn: c.depthIn,
      }));
  }
}
