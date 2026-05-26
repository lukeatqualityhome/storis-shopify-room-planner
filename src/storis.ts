import type { Config } from "./config.js";

export type StorisProduct = {
  id: string;
  productDescription: string | null;
  categoryId: string | null;
  categoryDescription: string | null;
  vendorId: string | null;
  vendorName: string | null;
  modelNumber: string | null;
  // Dimensions as returned by STORIS — units are not declared by the API.
  // QHF is a US furniture retailer so these are assumed to be inches.
  // Verify on the first dry-run by spot-checking a known product.
  width: number | null;
  depth: number | null;
  height: number | null;
};

type TokenCache = { accessToken: string; expiresAt: number } | null;

const CHANGES_PAGE_SIZE = 1000;
const DETAIL_BATCH_SIZE = 10;
const JOB_POLL_INTERVAL_MS = 1500;
const JOB_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export class StorisClient {
  private token: TokenCache = null;

  constructor(private readonly cfg: Config["storis"]) {}

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) {
      return this.token.accessToken;
    }
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await fetch(`${this.cfg.baseUrl}/api/authenticate`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) {
      throw new Error(`STORIS auth failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      success?: boolean;
      message?: string | null;
      token?: { access_token?: string; expires_in?: number; token_type?: string } | null;
    };
    const accessToken = body.token?.access_token;
    if (!accessToken) {
      throw new Error(`STORIS auth returned no token: success=${body.success} message=${body.message}`);
    }
    // expires_in is documented in DAYS for STORIS.
    const expiresInDays = body.token?.expires_in ?? 1;
    this.token = { accessToken, expiresAt: now + expiresInDays * 24 * 60 * 60 * 1000 };
    return accessToken;
  }

  private async authedGet<T>(path: string): Promise<T> {
    return this.authedRequest<T>("GET", path);
  }

  private async authedPost<T>(path: string): Promise<T> {
    return this.authedRequest<T>("POST", path);
  }

  // STORIS occasionally returns a 400 wrapping an upstream uniobjects timeout
  // (errorCode 15001 / "session has timed out") and 5xx errors during peak load.
  // Retry with exponential backoff on those; surface other errors immediately.
  private async authedRequest<T>(method: "GET" | "POST", path: string): Promise<T> {
    const token = await this.getToken();
    const url = `${this.cfg.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    };
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS - 1) throw err;
        await sleep(backoffMs(attempt));
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      const text = await res.text();
      const transient = isTransient(res.status, text);
      if (!transient || attempt >= MAX_ATTEMPTS - 1) {
        throw new Error(`STORIS ${method} ${path} failed: ${res.status} ${text}`);
      }
      console.error(
        `[storis] transient ${res.status} on ${method} ${path}, retry ${attempt + 1}/${MAX_ATTEMPTS - 1}`,
      );
      await sleep(backoffMs(attempt));
    }
    throw new Error(`STORIS ${method} ${path}: exhausted retries`);
  }

  async startChangesJob(): Promise<string> {
    type R = { data?: { jobId?: string | null } | null };
    const body = await this.authedPost<R>(
      `/api/Products/ChangesStartJob?NumberOfRecords=${CHANGES_PAGE_SIZE}`,
    );
    const jobId = body.data?.jobId;
    if (!jobId) throw new Error(`STORIS ChangesStartJob returned no jobId: ${JSON.stringify(body)}`);
    return jobId;
  }

  async waitForJob(jobId: string): Promise<{ numberOfPages: number; numberOfProducts: number }> {
    const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
    while (true) {
      type R = {
        data?: {
          jobStatus?: {
            status?: number | string;
            numberOfPages?: number | null;
            numberOfProducts?: number | null;
            error?: string | null;
            percentComplete?: number | null;
          } | null;
        } | null;
      };
      const body = await this.authedGet<R>(
        `/api/Products/ChangesJobStatus?JobId=${encodeURIComponent(jobId)}`,
      );
      const js = body.data?.jobStatus;
      const status = js?.status;
      // Status enum: 1=Complete, 2=Error, 3=InProgress, 4=NotStarted. May come back as number or name.
      const isComplete = status === 1 || status === "Complete";
      const isError = status === 2 || status === "Error";
      if (isComplete) {
        return {
          numberOfPages: js?.numberOfPages ?? 0,
          numberOfProducts: js?.numberOfProducts ?? 0,
        };
      }
      if (isError) {
        throw new Error(`STORIS Changes job ${jobId} failed: ${js?.error ?? "unknown error"}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`STORIS Changes job ${jobId} did not complete within ${JOB_POLL_TIMEOUT_MS}ms`);
      }
      await sleep(JOB_POLL_INTERVAL_MS);
    }
  }

  async fetchChunkPage(jobId: string, pageNumber: number): Promise<string[]> {
    type R = {
      data?: {
        availableOnWebProductIds?: string[] | null;
        notAvailableOnWebProductIds?: string[] | null;
      } | null;
    };
    const body = await this.authedGet<R>(
      `/api/Products/ChunkedProductChanges?JobId=${encodeURIComponent(jobId)}&PageNumber=${pageNumber}`,
    );
    const a = body.data?.availableOnWebProductIds ?? [];
    const b = body.data?.notAvailableOnWebProductIds ?? [];
    return [...a, ...b];
  }

  async fetchDetailBatch(productIds: string[]): Promise<StorisProduct[]> {
    if (productIds.length === 0) return [];
    if (productIds.length > DETAIL_BATCH_SIZE) {
      throw new Error(`fetchDetailBatch: max ${DETAIL_BATCH_SIZE} ids per call, got ${productIds.length}`);
    }
    const qs = productIds.map((id) => `ProductIds=${encodeURIComponent(id)}`).join("&");
    type R = {
      data?: { products?: unknown[] | null } | null;
    };
    const body = await this.authedGet<R>(`/api/Products/Detail?${qs}`);
    const raw = body.data?.products ?? [];
    return raw.map(normalizeProduct).filter((p): p is StorisProduct => p !== null);
  }

  // High-level: enumerate all available-on-web products and yield them in detail.
  async *iterateProducts(): AsyncGenerator<StorisProduct> {
    const jobId = await this.startChangesJob();
    const job = await this.waitForJob(jobId);
    const totalPages = job.numberOfPages || 1;

    for (let page = 1; page <= totalPages; page += 1) {
      const ids = await this.fetchChunkPage(jobId, page);
      if (ids.length === 0) break;
      for (const batch of chunk(ids, DETAIL_BATCH_SIZE)) {
        const products = await this.fetchDetailBatch(batch);
        for (const p of products) yield p;
      }
    }
  }
}

function normalizeProduct(raw: unknown): StorisProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  if (!id) return null;
  const category = (r.category && typeof r.category === "object" ? r.category : {}) as Record<string, unknown>;
  const dims = (r.dimensions && typeof r.dimensions === "object" ? r.dimensions : {}) as Record<string, unknown>;
  const vendor = (r.vendor && typeof r.vendor === "object" ? r.vendor : {}) as Record<string, unknown>;
  return {
    id,
    productDescription:
      typeof r.productDescription === "string" ? r.productDescription : null,
    categoryId: typeof category.categoryId === "string" ? category.categoryId : null,
    categoryDescription:
      typeof category.categoryDescription === "string" ? category.categoryDescription : null,
    vendorId: typeof vendor.id === "string" ? vendor.id : null,
    vendorName: typeof vendor.name === "string" ? vendor.name : null,
    modelNumber: typeof vendor.modelNumber === "string" ? vendor.modelNumber : null,
    width: numOrNull(dims.width),
    depth: numOrNull(dims.depth),
    height: numOrNull(dims.height),
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function* chunk<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s, 8s, 16s
  return 1000 * 2 ** attempt;
}

function isTransient(status: number, body: string): boolean {
  if (status >= 500) return true;
  if (status === 429) return true;
  if (status === 408) return true;
  if (status === 400) {
    // STORIS wraps some upstream transient errors as 400 with a nested 500.
    if (/internalservererror|session/i.test(body)) return true;
    if (/errorcode["\s:]+15001/i.test(body)) return true;
    if (/timed out|timeout/i.test(body)) return true;
  }
  return false;
}
