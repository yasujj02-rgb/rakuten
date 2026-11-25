/**
 * レート制御。
 * - SlidingWindowLimiter: クライアント毎の検索回数制限（isolate 内。分散環境では近似）
 * - SpacingQueue: 上流 API へのリクエスト間隔を空ける（楽天 API は短時間の連続アクセスを制限）
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  /** 許可なら true。不許可なら false */
  take(key: string): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 1000) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
    return true;
  }
}

export class SpacingQueue {
  private tail: Promise<void> = Promise.resolve();
  private last = 0;
  constructor(
    private readonly minIntervalMs: number,
    private readonly sleepFn: (ms: number) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = this.last + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleepFn(wait);
      this.last = this.now();
      return fn();
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
