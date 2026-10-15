export const READER_NETWORK_POLICY = {
  windowMs: 5_000,
  serialBelowBytesPerSecond: 128 * 1024,
  parallelAboveBytesPerSecond: 384 * 1024,
};

export type ReaderNetworkProgress = {
  phase: "start" | "progress" | "end";
  bytes: number;
};

/** Shared by all chapter segments so a slow connection really uses one request. */
export class ReaderLoadGovernor {
  private parallel = false;
  private slots = new Set<string>();
  private transfers = new Set<string>();
  private demands = new Map<string, { foreground: boolean; pending: boolean }>();
  private listeners = new Set<() => void>();
  private samples: Array<{ at: number; bytes: number }> = [];
  private busyIntervals: Array<{ start: number; end: number }> = [];
  private observedSince: number | null = null;
  private lastAt: number | null = null;
  private lastNetworkAt: number | null = null;

  get isParallel() {
    return this.parallel;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  setDemand(owner: string, foreground: boolean, pending: boolean) {
    const previous = this.demands.get(owner);
    this.demands.set(owner, { foreground, pending });
    if (previous?.foreground && previous.pending && (!foreground || !pending)) this.wake();
  }

  removeDemand(owner: string) {
    this.demands.delete(owner);
    this.wake();
  }

  tryAcquire(id: string, foreground: boolean, configuredMax: number, now = this.lastAt ?? 0) {
    if (this.slots.has(id)) return false;
    // Idle/CPU time is not a slow sample, but an old fast estimate must not
    // start another burst before this connection has been observed again.
    if (this.parallel && !this.transfers.size && this.lastNetworkAt != null &&
        now - this.lastNetworkAt >= READER_NETWORK_POLICY.windowMs) {
      this.parallel = false;
      this.resetWindow(now);
      this.wake();
    }
    const limit = this.parallel ? Math.max(1, configuredMax) : 1;
    if (this.slots.size >= limit) return false;
    if (!this.parallel && !foreground && [...this.demands.values()].some(
      (demand) => demand.foreground && demand.pending,
    )) return false;
    this.slots.add(id);
    return true;
  }

  report(id: string, event: ReaderNetworkProgress, now: number) {
    if (!this.slots.has(id)) return;
    this.advance(now);
    if (event.phase === "start") {
      if (!this.transfers.size && this.lastNetworkAt != null &&
          now - this.lastNetworkAt >= READER_NETWORK_POLICY.windowMs) {
        this.resetWindow(now);
      }
      this.observedSince ??= now;
      this.transfers.add(id);
    } else if (this.transfers.has(id)) {
      if (event.phase === "progress" && Number.isFinite(event.bytes) && event.bytes > 0) {
        this.samples.push({ at: now, bytes: event.bytes });
      }
      this.evaluate(now);
      if (event.phase === "end") this.transfers.delete(id);
    }
    this.lastNetworkAt = now;
  }

  release(id: string, now: number) {
    // Also closes telemetry after an IPC failure or cancellation.
    if (this.transfers.has(id)) this.report(id, { phase: "end", bytes: 0 }, now);
    this.slots.delete(id);
    this.wake();
  }

  tick(now: number) {
    this.advance(now);
    this.evaluate(now);
  }

  private advance(now: number) {
    if (this.lastAt != null && now > this.lastAt && this.transfers.size) {
      const previous = this.busyIntervals[this.busyIntervals.length - 1];
      if (previous?.end === this.lastAt) previous.end = now;
      else this.busyIntervals.push({ start: this.lastAt, end: now });
    }
    this.lastAt = now;
  }

  private evaluate(now: number) {
    const cutoff = now - READER_NETWORK_POLICY.windowMs;
    this.samples = this.samples.filter((sample) => sample.at > cutoff);
    this.busyIntervals = this.busyIntervals.filter((interval) => interval.end > cutoff);
    if (!this.transfers.size || this.observedSince == null || this.observedSince > cutoff) return;
    const busyMs = this.busyIntervals.reduce(
      (sum, interval) => sum + interval.end - Math.max(cutoff, interval.start), 0,
    );
    if (busyMs <= 0) return;
    const bytes = this.samples.reduce((sum, sample) => sum + sample.bytes, 0);
    const speed = bytes * 1000 / busyMs;
    const next = this.parallel
      ? speed > READER_NETWORK_POLICY.serialBelowBytesPerSecond
      : speed >= READER_NETWORK_POLICY.parallelAboveBytesPerSecond;
    if (next === this.parallel) return;
    this.parallel = next;
    // A new full window must confirm recovery; old fast samples cannot undo a slowdown.
    this.resetWindow(now);
    this.wake();
  }

  private resetWindow(now: number) {
    this.samples = [];
    this.busyIntervals = [];
    this.observedSince = now;
  }

  private wake() {
    for (const listener of this.listeners) listener();
  }
}
