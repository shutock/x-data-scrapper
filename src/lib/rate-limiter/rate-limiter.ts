import { throttle } from "lodash";

type QueueItem<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  retries: number;
  priority: number;
  timestamp: number;
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

type RateLimiterMetrics = {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  averageResponseTime: number;
  currentQueueSize: number;
  activeRequests: number;
  lastRequestTime: number;
};

export class RateLimiter {
  private queue: QueueItem<any>[] = [];
  private activeRequests = 0;
  private metrics: RateLimiterMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retriedRequests: 0,
    averageResponseTime: 0,
    currentQueueSize: 0,
    activeRequests: 0,
    lastRequestTime: 0,
  };

  private config: Required<RateLimiterConfig>;
  private processQueue: () => void;
  private isProcessing = false;

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

    const throttleDelay = Math.ceil(1000 / this.config.requestsPerSecond);
    this.processQueue = throttle(this._processQueue.bind(this), throttleDelay, {
      leading: true,
      trailing: true,
    });
  }

  async execute<T>(fn: () => Promise<T>, priority: number = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        fn,
        resolve,
        reject,
        retries: 0,
        priority,
        timestamp: Date.now(),
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

    while (
      this.queue.length > 0 &&
      this.activeRequests < this.config.maxConcurrent
    ) {
      const item = this.queue.shift();
      if (!item) break;

      this.metrics.currentQueueSize = this.queue.length;
      this.config.onQueueChange(this.queue.length);

      this.executeItem(item);
    }

    this.isProcessing = false;

    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), 100);
    }
  }

  private async executeItem<T>(item: QueueItem<T>): Promise<void> {
    this.activeRequests++;
    this.metrics.activeRequests = this.activeRequests;
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
    } catch (error) {
      await this.handleError(item, error, startTime);
    } finally {
      this.activeRequests--;
      this.metrics.activeRequests = this.activeRequests;
      this.processQueue();
    }
  }

  private async handleError<T>(
    item: QueueItem<T>,
    error: any,
    startTime: number,
  ): Promise<void> {
    const duration = Date.now() - startTime;
    this.updateAverageResponseTime(duration);

    if (item.retries < this.config.maxRetries) {
      item.retries++;
      this.metrics.retriedRequests++;

      const backoffDelay =
        this.config.retryDelay * Math.pow(2, item.retries - 1);
      const jitter = Math.random() * 0.3 * backoffDelay;
      const delay = backoffDelay + jitter;

      this.config.onError(
        error instanceof Error ? error : new Error(String(error)),
        item.retries,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));

      this.queue.unshift(item);
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
    return this.activeRequests;
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
    while (this.queue.length > 0 || this.activeRequests > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export const createRateLimiter = (config?: RateLimiterConfig): RateLimiter => {
  return new RateLimiter(config);
};
