import { promises as fs } from "fs";
import path from "path";
import ora from "ora";

import { getXData } from "~/src/get-x-data";
import { createRateLimiter } from "~/src/lib/rate-limiter";

const usernames = ["elonmusk", "BillGates", "BarackObama", "NASA", "SpaceX"];

const postsLimit = 50;
const delayBetweenPages = 4000;
const maxRetries = 3;

const loader = ora("Initializing rate limiter...").start();

const rateLimiter = createRateLimiter({
  requestsPerSecond: 2,
  maxConcurrent: 3,
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 120000,
  onError: (error, retries) => {
    loader.warn(`Error (retry ${retries}): ${error.message}`);
  },
  onSuccess: (duration) => {
    loader.succeed(`Request completed in ${(duration / 1000).toFixed(2)}s`);
    loader.start("Processing...");
  },
  onQueueChange: (queueSize) => {
    if (queueSize > 0) {
      loader.text = `Queue: ${queueSize} pending requests`;
    }
  },
});

const fetchUserData = async (username: string) => {
  return rateLimiter.execute(async () => {
    loader.text = `Fetching data for @${username}...`;
    const data = await getXData(username, {
      postsLimit,
      delayBetweenPages,
      maxRetries,
    });

    const outDir = path.join(process.cwd(), "out");
    await fs.mkdir(outDir, { recursive: true });

    const outFile = path.join(outDir, `${username}.json`);
    await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");

    return {
      username,
      tweetsCount: data.tweets.length,
      filePath: outFile,
    };
  }, 1);
};

try {
  loader.text = `Starting batch fetch for ${usernames.length} users...`;

  const startTime = Date.now();
  const results = await Promise.all(usernames.map(fetchUserData));

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  const metrics = rateLimiter.getMetrics();

  loader.succeed(`All requests completed in ${totalTime}s`);

  console.log("\n📊 Results:");
  results.forEach((result) => {
    console.log(
      `  ✓ @${result.username}: ${result.tweetsCount} tweets → ${result.filePath}`,
    );
  });

  console.log("\n📈 Rate Limiter Metrics:");
  console.log(`  Total Requests: ${metrics.totalRequests}`);
  console.log(`  Successful: ${metrics.successfulRequests}`);
  console.log(`  Failed: ${metrics.failedRequests}`);
  console.log(`  Retried: ${metrics.retriedRequests}`);
  console.log(
    `  Avg Response Time: ${(metrics.averageResponseTime / 1000).toFixed(2)}s`,
  );
  console.log(`  Queue Size: ${metrics.currentQueueSize}`);
  console.log(`  Active Requests: ${metrics.activeRequests}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  loader.fail(message);
  console.error(error);
}
