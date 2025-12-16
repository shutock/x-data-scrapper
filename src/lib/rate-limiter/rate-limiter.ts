import { throttle } from "lodash";

import { RATE_LIMITER_BURST_CAPACITY } from "~/src/lib/constants";

type QueueItem<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  retries: number;
  priority: number;
  timestamp: number;
  sessionId?: string;
};

type RateLimiterConfig = {
  requestsPerSecond?: number;
  maxConcurrent?: number;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  onError?: (error: Error, retries: number) => void;
  onSuccess?: (duration: number) => void;
  onQueueChange?: (queueSize: number) => void;
};

type SessionState = {
  id: string;
  tokens: number;
  activeRequests: number;
  remaining: number;
  reset: number;
  isLimited: boolean;
  nextAvailableTime: number;
  requestsPerSecond: number; // Dynamic based on headers
};

type RateLimiterMetrics = {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  averageResponseTime: number;
  currentQueueSize: number;
  activeRequests: number;
  lastRequestTime: number;
  sessionCount: number;
};

export class RateLimiter {
  private queue: QueueItem<any>[] = [];
  private metrics: RateLimiterMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retriedRequests: 0,
    averageResponseTime: 0,
    currentQueueSize: 0,
    activeRequests: 0,
    lastRequestTime: 0,
    sessionCount: 0,
  };

  private config: Required<RateLimiterConfig>;
  private sessions: Map<string, SessionState> = new Map();
  private defaultSessionId = "default";

  private processQueue: () => void;
  private isProcessing = false;
  private refillIntervalMs: number = 1000;
  private refillTimer: any;

  constructor(config: RateLimiterConfig = {}) {
    this.config = {
      requestsPerSecond: config.requestsPerSecond ?? 2,
      maxConcurrent: config.maxConcurrent ?? 5,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      timeout: config.timeout ?? 60000,
      onError: config.onError ?? (() => {}),
      onSuccess: config.onSuccess ?? (() => {}),
      onQueueChange: config.onQueueChange ?? (() => {}),
    };

    // Initialize default session
    this.createSession(this.defaultSessionId);

    const throttleDelay = 100; // Fast check loop
    this.processQueue = throttle(this._processQueue.bind(this), throttleDelay, {
      leading: true,
      trailing: true,
    });

    this.refillTimer = setInterval(() => {
      this.refillTokens();
      this.processQueue();
    }, this.refillIntervalMs);
  }

  private createSession(id: string) {
    if (!this.sessions.has(id)) {
      this.sessions.set(id, {
        id,
        tokens: this.config.requestsPerSecond, // Start with full tokens
        activeRequests: 0,
        remaining: 100, // Default assumption
        reset: Date.now() / 1000 + 900,
        isLimited: false,
        nextAvailableTime: 0,
        requestsPerSecond: this.config.requestsPerSecond,
      });
      this.metrics.sessionCount++;
    }
  }

  private refillTokens() {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      // Calculate burst cap: use configured burst capacity (15) or remaining if lower
      const burstCap = Math.min(session.remaining, RATE_LIMITER_BURST_CAPACITY);

      // Refill tokens up to burst cap
      session.tokens = Math.min(
        session.tokens + session.requestsPerSecond,
        burstCap,
      );

      // Check if limited state expired
      if (session.isLimited && now >= session.nextAvailableTime) {
        session.isLimited = false;
      }
    }
  }

  updateRateLimit(sessionId: string, headers: Record<string, string>) {
    const session = this.sessions.get(sessionId || this.defaultSessionId);
    if (!session) return;

    const remaining = Number.parseInt(
      headers["x-rate-limit-remaining"] || "",
      10,
    );
    const reset = Number.parseInt(headers["x-rate-limit-reset"] || "", 10);

    if (!Number.isNaN(remaining)) session.remaining = remaining;
    if (!Number.isNaN(reset)) session.reset = reset;

    // Simplified: Keep static rate, only track remaining for soft blocking
    // Dynamic adjustment removed due to inconsistent Nitter headers
    if (remaining <= 10 && reset > Date.now() / 1000) {
      console.warn(
        `[RateLimiter] Session ${sessionId} has low remaining (${remaining})`,
      );
    }
  }

  async execute<T>(
    fn: () => Promise<T>,
    priority: number = 0,
    sessionId?: string,
  ): Promise<T> {
    const targetSessionId = sessionId || this.defaultSessionId;
    this.createSession(targetSessionId);

    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        fn,
        resolve,
        reject,
        retries: 0,
        priority,
        timestamp: Date.now(),
        sessionId: targetSessionId,
      };

      this.queue.push(item);
      this.queue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.timestamp - b.timestamp;
      });

      this.metrics.currentQueueSize = this.queue.length;
      this.config.onQueueChange(this.queue.length);

      this.processQueue();
    });
  }

  private async _processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Iterate through queue and find executable items
    // We can't just shift() because the head item might be blocked by its session
    // while a later item might be runnable on a different session.
    // However, for strict priority, we should block.
    // But usually we want throughput. Let's try to pick first runnable item.

    const unhandledItems: QueueItem<any>[] = [];

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      const session = this.sessions.get(
        item.sessionId || this.defaultSessionId,
      );

      if (!session) {
        // Should not happen as we create on execute
        unhandledItems.push(item);
        continue;
      }

      // Check constraints
      const now = Date.now();

      // 1. Session Limited / Backoff
      if (session.isLimited && now < session.nextAvailableTime) {
        unhandledItems.push(item);
        continue;
      }

      // 2. Per-session Concurrency
      const perSessionLimit = this.config.maxConcurrent;
      if (session.activeRequests >= perSessionLimit) {
        unhandledItems.push(item);
        continue;
      }

      // 3. Tokens
      if (session.tokens < 1) {
        unhandledItems.push(item);
        continue;
      }

      // 4. "If remaining <= 10 and reset > now, prefer not to use"
      // We implement this as a soft block
      if (session.remaining <= 10 && session.reset > now / 1000) {
        // Only allow if we really have to? Or just block.
        // User says "prefer not to use... do not queue new ones".
        // We already queued it. Let's block it.
        unhandledItems.push(item);
        continue;
      }

      // Runnable
      session.tokens -= 1;
      this.executeItem(item, session);
    }

    // Put back unhandled items
    // This reordering might violate strict priority if we skip items.
    // But it's necessary for multi-session fairness.
    // To preserve order of unhandled items:
    this.queue = [...unhandledItems, ...this.queue];

    this.metrics.currentQueueSize = this.queue.length;
    this.config.onQueueChange(this.queue.length);

    this.isProcessing = false;

    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), 100);
    }
  }

  private async executeItem<T>(
    item: QueueItem<T>,
    session: SessionState,
  ): Promise<void> {
    session.activeRequests++;
    this.metrics.activeRequests++; // Global active (fix: this.activeRequests property was removed in class, use metrics)
    this.metrics.totalRequests++;

    const startTime = Date.now();

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Request timeout")),
          this.config.timeout,
        ),
      );

      const result = await Promise.race([item.fn(), timeoutPromise]);

      const duration = Date.now() - startTime;
      this.updateAverageResponseTime(duration);

      this.metrics.successfulRequests++;
      this.metrics.lastRequestTime = Date.now();
      this.config.onSuccess(duration);

      item.resolve(result);
    } catch (error: any) {
      await this.handleError(item, error, startTime, session);
    } finally {
      session.activeRequests--;
      this.metrics.activeRequests--;
      this.processQueue();
    }
  }

  private async handleError<T>(
    item: QueueItem<T>,
    error: any,
    startTime: number,
    session: SessionState,
  ): Promise<void> {
    const duration = Date.now() - startTime;
    this.updateAverageResponseTime(duration);

    // Check for 429 or RateLimitError
    const isRateLimit =
      error?.message?.includes("429") ||
      error?.status === 429 ||
      error?.name === "RateLimitError";

    if (isRateLimit) {
      session.isLimited = true;
      // More aggressive cooldown: 90s + jitter (0-20s)
      const nowSeconds = Date.now() / 1000;
      let waitSeconds =
        session.reset > nowSeconds ? session.reset - nowSeconds : 90;
      waitSeconds += Math.random() * 20; // Increased jitter

      session.nextAvailableTime = Date.now() + waitSeconds * 1000;

      console.warn(
        `[RateLimiter] Rate limited on ${session.id}, ` +
          `cooldown until ${new Date(session.nextAvailableTime).toISOString()}`,
      );
    }

    if (item.retries < this.config.maxRetries) {
      item.retries++;
      this.metrics.retriedRequests++;

      const baseBackoff = this.config.retryDelay * 2 ** (item.retries - 1);
      const jitter = Math.random() * 0.2 * baseBackoff; // +/- 20%
      let delay = baseBackoff + jitter;

      if (isRateLimit) {
        // If rate limited, the delay is already handled by session.nextAvailableTime check in processQueue
        // But we should push it back to queue.
        delay = 0; // It will just sit in queue until session is ready
      }

      this.config.onError(
        error instanceof Error ? error : new Error(String(error)),
        item.retries,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));

      this.queue.unshift(item); // Re-queue at front
      this.metrics.currentQueueSize = this.queue.length;
      this.config.onQueueChange(this.queue.length);
    } else {
      this.metrics.failedRequests++;
      this.config.onError(
        error instanceof Error ? error : new Error(String(error)),
        item.retries,
      );
      item.reject(error);
    }
  }

  private updateAverageResponseTime(duration: number): void {
    const totalCompleted =
      this.metrics.successfulRequests + this.metrics.failedRequests;
    if (totalCompleted === 0) {
      this.metrics.averageResponseTime = duration;
    } else {
      this.metrics.averageResponseTime =
        (this.metrics.averageResponseTime * (totalCompleted - 1) + duration) /
        totalCompleted;
    }
  }

  getMetrics(): Readonly<RateLimiterMetrics> {
    return { ...this.metrics };
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getActiveRequests(): number {
    return this.metrics.activeRequests;
  }

  clearQueue(): void {
    const items = [...this.queue];
    this.queue = [];
    this.metrics.currentQueueSize = 0;
    this.config.onQueueChange(0);

    items.forEach((item) => {
      item.reject(new Error("Queue cleared"));
    });
  }

  async waitForCompletion(): Promise<void> {
    while (this.queue.length > 0 || this.metrics.activeRequests > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  destroy(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = undefined;
    }
    this.clearQueue();
  }
}

export const createRateLimiter = (config?: RateLimiterConfig): RateLimiter => {
  return new RateLimiter(config);
};
