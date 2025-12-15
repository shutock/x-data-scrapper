import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Hono } from "hono";

import {
  DELAY_BETWEEN_PAGES,
  MAX_RETRIES,
  POSTS_LIMIT,
} from "~/src/lib/constants";
import { createRateLimiter } from "~/src/lib/rate-limiter";

import { getXData } from "./get-x-data";

export const app = new Hono();

const rateLimiter = createRateLimiter({
  requestsPerSecond: 2,
  maxConcurrent: 5,
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 120000,
  onError: (error, retries) => {
    console.error(`[RateLimiter] Error (retry ${retries}):`, error.message);
  },
  onSuccess: (duration) => {
    console.log(`[RateLimiter] Request completed in ${duration}ms`);
  },
  onQueueChange: (queueSize) => {
    if (queueSize > 0) {
      console.log(`[RateLimiter] Queue size: ${queueSize}`);
    }
  },
});

app.get("/metrics", (c) => {
  const metrics = rateLimiter.getMetrics();
  return c.json({
    ...metrics,
    queueSize: rateLimiter.getQueueSize(),
    activeRequests: rateLimiter.getActiveRequests(),
  });
});

app.get("/:username", async (c) => {
  const username = c.req.param("username");
  const postsLimit = Number(c.req.query("postsLimit") || POSTS_LIMIT);
  const delayBetweenPages = Number(
    c.req.query("delayBetweenPages") || DELAY_BETWEEN_PAGES,
  );
  const maxRetries = Number(c.req.query("maxRetries") || MAX_RETRIES);

  try {
    const data = await rateLimiter.execute(async () => {
      return await getXData(username, {
        postsLimit,
        delayBetweenPages,
        maxRetries,
      });
    }, 1);

    const outDir = path.join(process.cwd(), "out");
    await fs.mkdir(outDir, { recursive: true });

    const outFile = path.join(outDir, `${username}.json`);
    await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");

    return c.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});
