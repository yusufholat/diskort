/** Aynı anda en fazla `max` iş; fazlası sırada bekler (sıra doluysa hemen hata). */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue = Number.POSITIVE_INFINITY,
  ) {}

  get busy(): boolean {
    return this.active > 0 || this.queue.length > 0;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.max) this.active++;
    else {
      if (this.queue.length >= this.maxQueue) throw new Error('Sıra dolu.');
      // Boşalan yer doğrudan sıradakine geçer (active azalmaz)
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/** Anahtar başına (ör. alan adı) ayrı sınır; boşalan anahtarlar unutulur. */
export class KeyedLimiter {
  private readonly limiters = new Map<string, ConcurrencyLimiter>();

  constructor(
    private readonly max: number,
    private readonly maxQueue = Number.POSITIVE_INFINITY,
  ) {}

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = new ConcurrencyLimiter(this.max, this.maxQueue);
      this.limiters.set(key, limiter);
    }
    try {
      return await limiter.run(fn);
    } finally {
      if (!limiter.busy) this.limiters.delete(key);
    }
  }
}
