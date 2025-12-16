import type { Page } from "puppeteer";
import puppeteer from "puppeteer";
import { Cluster } from "puppeteer-cluster";

import type {
  BrowserPoolConfig,
  BrowserPoolStatus,
  BrowserPoolTask,
} from "./types";

export class BrowserPool {
  private cluster: Cluster<unknown, unknown> | null = null;
  private config: BrowserPoolConfig;
  private stats = {
    completedTasks: 0,
    failedTasks: 0,
  };

  constructor(config: Partial<BrowserPoolConfig> = {}) {
    this.config = {
      concurrency: config.concurrency ?? 5,
      maxConcurrency: config.maxConcurrency ?? 10,
      timeout: config.timeout ?? 600000, // 10 minutes
      retryLimit: config.retryLimit ?? 2,
      retryDelay: config.retryDelay ?? 5000,
      puppeteerOptions: config.puppeteerOptions ?? {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--max-old-space-size=2048",
        ],
      },
    };
  }

  async initialize(): Promise<void> {
    this.cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT, // Share browser, separate contexts
      maxConcurrency: this.config.concurrency,
      timeout: this.config.timeout,
      retryLimit: this.config.retryLimit,
      retryDelay: this.config.retryDelay,
      puppeteerOptions: this.config.puppeteerOptions,
      monitor: false,
      puppeteer,
    });

    this.cluster.on("taskerror", (err, _data) => {
      console.error("[BrowserPool] Task error:", err.message);
      this.stats.failedTasks++;
    });

    console.log(
      `[BrowserPool] Initialized with ${this.config.concurrency} workers`,
    );
  }

  async execute<T>(task: BrowserPoolTask<T>): Promise<T> {
    if (!this.cluster) {
      throw new Error("Browser pool not initialized. Call initialize() first.");
    }

    const result = await this.cluster.execute(
      async ({ page }: { page: Page }) => {
        return await task(page);
      },
    );

    this.stats.completedTasks++;
    return result as T;
  }

  getStatus(): BrowserPoolStatus {
    return {
      workerCount: this.config.concurrency,
      activeWorkers: 0, // Not exposed by puppeteer-cluster
      queueSize: 0, // Not exposed by puppeteer-cluster
      completedTasks: this.stats.completedTasks,
      failedTasks: this.stats.failedTasks,
    };
  }

  async destroy(): Promise<void> {
    if (this.cluster) {
      await this.cluster.idle();
      await this.cluster.close();
      this.cluster = null;
      console.log("[BrowserPool] Destroyed");
    }
  }
}
