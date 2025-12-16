import type { Page } from "puppeteer";

export interface BrowserPoolConfig {
  concurrency: number; // Number of browser workers
  maxConcurrency: number; // Max tasks in queue
  timeout: number; // Task timeout (ms)
  retryLimit: number; // Retry failed tasks
  retryDelay: number; // Delay between retries (ms)
  puppeteerOptions?: {
    headless: boolean;
    args: string[];
  };
}

export type BrowserPoolTask<T> = (page: Page) => Promise<T>;

export interface BrowserPoolStatus {
  workerCount: number;
  activeWorkers: number;
  queueSize: number;
  completedTasks: number;
  failedTasks: number;
}
