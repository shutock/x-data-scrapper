import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Hono } from "hono";
import { z } from "zod";

import { BrowserPool } from "~/src/lib/browser-pool";
import {
  BROWSER_POOL_SIZE,
  NITTER_HEALTH_CHECK_INTERVAL,
  RATE_LIMITER_MAX_CONCURRENT,
  RATE_LIMITER_MAX_RETRIES,
  RATE_LIMITER_REQUESTS_PER_SECOND,
  RATE_LIMITER_RETRY_DELAY,
  RATE_LIMITER_TIMEOUT,
} from "~/src/lib/constants";
import { NitterInstancePool } from "~/src/lib/nitter-pool";
import { createRateLimiter } from "~/src/lib/rate-limiter";

import { getXData } from "./get-x-data";

export const app = new Hono();

// Initialize Nitter instance pool
const nitterPool = new NitterInstancePool();
await nitterPool.initialize();
nitterPool.startPeriodicHealthChecks(NITTER_HEALTH_CHECK_INTERVAL);

// Initialize Browser pool
const browserPool = new BrowserPool({
  concurrency: BROWSER_POOL_SIZE,
  timeout: 600000, // 10 minutes
});
await browserPool.initialize();

// Limiter for concurrent scraping jobs (system resources)
const jobLimiter = createRateLimiter({
  maxConcurrent: 5,
  requestsPerSecond: 100, // High limit, effectively just semaphore
  timeout: 600000, // 10 minutes for a job
  onQueueChange: (queueSize) => {
    if (queueSize > 0) {
      console.log(`[JobLimiter] Queue size: ${queueSize}`);
    }
  },
});

// Limiter for Nitter API requests (rate limits)
const nitterLimiter = createRateLimiter({
  requestsPerSecond: RATE_LIMITER_REQUESTS_PER_SECOND,
  maxConcurrent: RATE_LIMITER_MAX_CONCURRENT,
  maxRetries: RATE_LIMITER_MAX_RETRIES,
  retryDelay: RATE_LIMITER_RETRY_DELAY,
  timeout: RATE_LIMITER_TIMEOUT,
  onError: (error, retries) => {
    console.error(`[NitterLimiter] Error (retry ${retries}):`, error.message);
  },
  onSuccess: (duration) => {
    console.log(`[NitterLimiter] Request completed in ${duration}ms`);
  },
  onQueueChange: (queueSize) => {
    if (queueSize > 0) {
      console.log(`[NitterLimiter] Queue size: ${queueSize}`);
    }
  },
});

app.get("/health", (c) => {
  const nitterHealth = nitterPool.getHealthStatus();
  const browserHealth = browserPool.getStatus();
  const healthyCount = nitterHealth.filter(
    (i) => i.status === "healthy",
  ).length;

  return c.json(
    {
      status: healthyCount > 0 ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      nitterInstances: {
        total: nitterHealth.length,
        healthy: healthyCount,
        instances: nitterHealth,
      },
      browserPool: browserHealth,
    },
    healthyCount > 0 ? 200 : 503,
  );
});

app.get("/metrics", (c) => {
  const nitterMetrics = nitterLimiter.getMetrics();
  const jobMetrics = jobLimiter.getMetrics();

  return c.json({
    nitter: {
      ...nitterMetrics,
      queueSize: nitterLimiter.getQueueSize(),
      activeRequests: nitterLimiter.getActiveRequests(),
    },
    jobs: {
      ...jobMetrics,
      queueSize: jobLimiter.getQueueSize(),
      activeRequests: jobLimiter.getActiveRequests(),
    },
  });
});

// Request validation schema
const querySchema = z.object({
  postsLimit: z.coerce.number().min(1).max(5000).default(100),
  delayBetweenPages: z.coerce.number().min(1000).max(30000).default(4000),
  maxRetries: z.coerce.number().min(1).max(10).default(3),
});

app.get("/x-data/:username", async (c) => {
  const username = c.req.param("username");

  // Validate username
  if (!username || username.length < 1 || username.length > 50) {
    return c.json({ error: "Invalid username" }, 400);
  }

  // Validate query params
  const result = querySchema.safeParse({
    postsLimit: c.req.query("postsLimit"),
    delayBetweenPages: c.req.query("delayBetweenPages"),
    maxRetries: c.req.query("maxRetries"),
  });

  if (!result.success) {
    return c.json(
      {
        error: "Invalid query parameters",
        details: result.error.format(),
      },
      400,
    );
  }

  const { postsLimit, delayBetweenPages, maxRetries } = result.data;

  try {
    const sessionId = `user-${username}-${Date.now()}`;
    const baseURL = nitterPool.getHealthyInstance(sessionId);

    const data = await jobLimiter.execute(async () => {
      return await getXData(username, {
        postsLimit,
        delayBetweenPages,
        maxRetries,
        rateLimiter: nitterLimiter,
        baseURL,
        sessionId,
        browserPool,
      });
    }, 1);

    const outDir = path.join(process.cwd(), "out");
    await fs.mkdir(outDir, { recursive: true });

    const outFile = path.join(outDir, `${username}.json`);
    await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");

    // Check if instance returned suspiciously low results (possible failure)
    // If requested 100+ tweets but got 0, mark instance as problematic
    if (postsLimit >= 50 && data.tweets.length === 0) {
      console.warn(
        `[App] Instance ${baseURL} returned 0 tweets for ${username}, marking as potentially failed`,
      );
      nitterPool.markInstanceFailed(baseURL, false);
    }

    // Mark instance as successful if we got good results
    if (data.tweets.length > 0) {
      nitterPool.markInstanceSuccess(baseURL);
    }

    // Return with metadata
    return c.json({
      ...data,
      metadata: {
        collected: data.tweets.length,
        requested: postsLimit,
        status: "complete",
        instance: baseURL,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Mark instance as failed on error
    try {
      const sessionId = `user-${username}-${Date.now()}`;
      const baseURL = nitterPool.getHealthyInstance(sessionId);
      nitterPool.markInstanceFailed(baseURL, false);
    } catch {}

    return c.json({ error: message }, 500);
  }
});

// Export resources for cleanup
export const getAppResources = () => ({
  jobLimiter,
  nitterLimiter,
  nitterPool,
  browserPool,
});
