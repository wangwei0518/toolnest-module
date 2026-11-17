/** Bound verification work even when the application is behind an untrusted proxy. */
export class VerificationLimiter {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  private global = { count: 0, until: 0 };

  constructor(private readonly maxPerKey = 8) {}

  allow(id: string, now = Date.now()) {
    if (this.global.until <= now) this.global = { count: 0, until: now + 60_000 };
    if (this.global.count >= 120) return false;
    this.global.count += 1;
    if (this.attempts.size >= 4096) {
      for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
      if (this.attempts.size >= 4096 && !this.attempts.has(id)) return false;
    }
    let state = this.attempts.get(id);
    if (!state || state.until <= now) {
      state = { count: 0, until: now + 60_000 };
      this.attempts.set(id, state);
    }
    if (state.count >= this.maxPerKey) return false;
    state.count += 1;
    return true;
  }

  success(id: string) { this.attempts.delete(id); }
}
