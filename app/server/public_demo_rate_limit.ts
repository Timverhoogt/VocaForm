export type PublicModelOperation = "compile" | "verify" | "realtime";

interface RateLimitRule {
  visitorLimit: number;
  addressLimit: number;
  windowMs: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const RULES: Record<PublicModelOperation, RateLimitRule> = {
  compile: { visitorLimit: 3, addressLimit: 12, windowMs: 60 * 60 * 1_000 },
  verify: { visitorLimit: 10, addressLimit: 30, windowMs: 60 * 60 * 1_000 },
  realtime: { visitorLimit: 10, addressLimit: 30, windowMs: 60 * 60 * 1_000 }
};

export class PublicDemoRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  consume(operation: PublicModelOperation, visitorId: string, address: string, now = Date.now()): RateLimitResult {
    this.prune(now);
    const rule = RULES[operation];
    const keys = [
      { key: `${operation}:visitor:${visitorId}`, limit: rule.visitorLimit },
      { key: `${operation}:address:${address}`, limit: rule.addressLimit }
    ];
    const buckets = keys.map(({ key }) => this.currentBucket(key, now, rule.windowMs));
    const blocked = buckets.find((bucket, index) => bucket.count >= (keys[index]?.limit ?? 0));
    if (blocked) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((blocked.resetAt - now) / 1_000))
      };
    }
    for (const bucket of buckets) bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private currentBucket(key: string, now: number, windowMs: number): RateLimitBucket {
    const existing = this.buckets.get(key);
    if (existing && existing.resetAt > now) return existing;
    const bucket = { count: 0, resetAt: now + windowMs };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private prune(now: number): void {
    if (this.buckets.size < 1_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    while (this.buckets.size >= 10_000) {
      const oldestKey = this.buckets.keys().next().value;
      if (!oldestKey) break;
      this.buckets.delete(oldestKey);
    }
  }
}
