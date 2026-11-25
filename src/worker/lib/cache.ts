/**
 * 短時間キャッシュ。Cloudflare の Cache API（caches.default）があれば使用し、
 * 無ければ isolate 内メモリ（最大件数制限付き）を使う。長期保存はしない。
 */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface JsonCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

const CACHE_ORIGIN = 'https://cache.netprice-watch.internal';

export class MemoryCache implements JsonCache {
  private store = new Map<string, { value: unknown; expires: number }>();
  constructor(
    private readonly maxEntries = 100,
    private readonly now: () => number = Date.now,
  ) {}
  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: this.now() + ttlSeconds * 1000 });
  }
}

export class EdgeCache implements JsonCache {
  constructor(private readonly cache: CacheLike) {}
  private req(key: string) {
    return new Request(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`);
  }
  async get<T>(key: string): Promise<T | null> {
    const res = await this.cache.match(this.req(key));
    if (!res) return null;
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.cache.put(
      this.req(key),
      new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttlSeconds}` },
      }),
    );
  }
}

/** 2 段キャッシュ（isolate メモリ → エッジ） */
export class TieredCache implements JsonCache {
  constructor(private readonly tiers: JsonCache[]) {}
  async get<T>(key: string): Promise<T | null> {
    for (const t of this.tiers) {
      const v = await t.get<T>(key);
      if (v !== null) return v;
    }
    return null;
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await Promise.all(this.tiers.map((t) => t.set(key, value, ttlSeconds)));
  }
}

export function getEdgeCache(): CacheLike | null {
  const c = (globalThis as unknown as { caches?: { default?: CacheLike } }).caches;
  return c?.default ?? null;
}

/** 同一キーの同時リクエストを 1 本にまとめる */
export class InflightDeduper {
  private inflight = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
