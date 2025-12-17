import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Hono } from "hono";
import { z } from "zod";

import { BrowserPool } from "~/src/lib/browser-pool";
import {
  BROWSER_POOL_SIZE,
  INSTANCE_RETRY_DELAY_MS,
  MAX_INSTANCE_RETRIES,
  NITTER_HEALTH_CHECK_INTERVAL,
  PARTIAL_RESULTS_MIN_THRESHOLD,
  RATE_LIMITER_MAX_CONCURRENT,
  RATE_LIMITER_MAX_RETRIES,
  RATE_LIMITER_REQUESTS_PER_SECOND,
  RATE_LIMITER_RETRY_DELAY,
  RATE_LIMITER_TIMEOUT,
  SAVE_TO_FILE,
  SCRAPING_TIMEOUT_MS,
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

// Helper: Save to file if enabled (async, non-blocking)
async function saveToFileIfEnabled(username: string, data: any): Promise<void> {
  if (!SAVE_TO_FILE) return;

  const outDir = path.join(process.cwd(), "out");
  const outFile = path.join(outDir, `${username}.json`);

  // Fire-and-forget async save
  fs.mkdir(outDir, { recursive: true })
    .then(() => fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8"))
    .then(() => console.log(`[App] Saved ${username}.json`))
    .catch((err) =>
      console.error(`[App] Failed to save ${username}.json:`, err),
    );
}

// Request validation schema
const querySchema = z.object({
  tweetsLimit: z.coerce.number().min(1).max(5000).default(100),
  delayBetweenPages: z.coerce.number().min(1000).max(30000).default(4000),
  maxRetries: z.coerce.number().min(1).max(10).default(3),
});

// Username validation schema
const usernameSchema = z
  .string()
  .min(1, "Username too short")
  .max(15, "Username too long (max 15 chars)")
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "Username can only contain letters, numbers, and underscores",
  );

app.get("/x-data/:username", async (c) => {
  const username = c.req.param("username");

  // Validate username with proper pattern
  const usernameResult = usernameSchema.safeParse(username);
  if (!usernameResult.success) {
    return c.json(
      {
        error: "Invalid username",
        details: usernameResult.error.format(),
      },
      400,
    );
  }

  const validatedUsername = usernameResult.data;

  // Validate query params
  const result = querySchema.safeParse({
    tweetsLimit: c.req.query("tweetsLimit"),
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

  const { tweetsLimit, delayBetweenPages, maxRetries } = result.data;

  let lastError: Error | null = null;
  let partialData: any = null;
  const minTweetsForPartial = Math.ceil(
    tweetsLimit * PARTIAL_RESULTS_MIN_THRESHOLD,
  );

  // Try up to MAX_INSTANCE_RETRIES different instances
  for (let attempt = 0; attempt < MAX_INSTANCE_RETRIES; attempt++) {
    let baseURL = "";
    let timeoutOccurred = false;

    try {
      const sessionId = `user-${validatedUsername}-${Date.now()}`;
      baseURL = nitterPool.getHealthyInstance(sessionId);

      console.log(
        `[App] Attempt ${attempt + 1}/${MAX_INSTANCE_RETRIES} for ${validatedUsername} using ${baseURL}`,
      );

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          timeoutOccurred = true;
          reject(new Error("SCRAPING_TIMEOUT"));
        }, SCRAPING_TIMEOUT_MS);
      });

      // Create scraping promise with progress tracking
      const scrapingPromise = jobLimiter.execute(async () => {
        return await getXData(validatedUsername, {
          tweetsLimit,
          delayBetweenPages,
          maxRetries,
          rateLimiter: nitterLimiter,
          baseURL,
          sessionId,
          browserPool,
          onProgress: (currentData) => {
            // Save partial data for timeout case
            partialData = currentData;
          },
        });
      }, 1);

      // Race between scraping and timeout
      const data = await Promise.race([scrapingPromise, timeoutPromise]);

      // Success! Save file and return
      await saveToFileIfEnabled(validatedUsername, data);

      // Check if result is suspiciously empty (possible instance failure)
      if (tweetsLimit >= 50 && data.tweets.length === 0) {
        console.warn(
          `[App] Instance ${baseURL} returned 0 tweets for ${validatedUsername}, marking as potentially failed`,
        );
        nitterPool.markInstanceFailed(baseURL, false);

        // If this was first/second attempt, try another instance
        if (attempt < MAX_INSTANCE_RETRIES - 1) {
          lastError = new Error(`Instance returned 0 tweets`);
          await new Promise((resolve) =>
            setTimeout(resolve, INSTANCE_RETRY_DELAY_MS),
          );
          continue;
        }
      }

      // Got good results - mark instance as successful
      if (data.tweets.length > 0) {
        nitterPool.markInstanceSuccess(baseURL);
      }

      return c.json({
        ...data,
        metadata: {
          collected: data.tweets.length,
          requested: tweetsLimit,
          status: "complete",
          instance: baseURL,
          attempts: attempt + 1,
        },
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if timeout occurred with enough partial data
      if (
        timeoutOccurred &&
        partialData &&
        partialData.tweets &&
        partialData.tweets.length >= minTweetsForPartial
      ) {
        console.warn(
          `[App] Request timed out for ${validatedUsername}, returning partial results (${partialData.tweets.length}/${tweetsLimit})`,
        );

        await saveToFileIfEnabled(validatedUsername, partialData);

        return c.json(
          {
            ...partialData,
            metadata: {
              collected: partialData.tweets.length,
              requested: tweetsLimit,
              status: "partial",
              reason: "timeout",
              instance: baseURL,
              attempts: attempt + 1,
            },
          },
          206,
        ); // 206 Partial Content
      }

      // Mark failed instance
      if (baseURL) {
        const isRateLimit =
          lastError.message.includes("429") ||
          lastError.message.includes("rate limit");
        nitterPool.markInstanceFailed(baseURL, isRateLimit);
        console.error(
          `[App] Attempt ${attempt + 1} failed with ${baseURL}:`,
          lastError.message,
        );
      }

      // If not last attempt, try next instance
      if (attempt < MAX_INSTANCE_RETRIES - 1) {
        console.log(
          `[App] Retrying with different instance in ${INSTANCE_RETRY_DELAY_MS}ms...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, INSTANCE_RETRY_DELAY_MS),
        );
        continue;
      }

      // All attempts failed
      break;
    }
  }

  // All instances failed
  return c.json(
    {
      error: lastError?.message || "All Nitter instances failed",
      metadata: {
        collected: partialData?.tweets?.length || 0,
        requested: tweetsLimit,
        status: "failed",
        instance: "all_failed",
        attempts: MAX_INSTANCE_RETRIES,
      },
    },
    500,
  );
});

// Export resources for cleanup
export const getAppResources = () => ({
  jobLimiter,
  nitterLimiter,
  nitterPool,
  browserPool,
});
