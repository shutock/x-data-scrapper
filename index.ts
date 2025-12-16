import { app, getAppResources } from "~/src";
import { PORT, SERVER_TIMEOUT } from "~/src/lib/constants";

const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}, initiating graceful shutdown...`);

  try {
    const resources = getAppResources();

    // Step 1: Wait for active scraping jobs (max 2 minutes)
    console.log("Waiting for active jobs to complete...");
    await Promise.race([
      resources.jobLimiter.waitForCompletion(),
      new Promise((resolve) => setTimeout(resolve, 120000)),
    ]);

    // Step 2: Close browser pool
    console.log("Closing browser pool...");
    await resources.browserPool.destroy();

    // Step 3: Stop Nitter health checks
    console.log("Stopping Nitter health checks...");
    resources.nitterPool.destroy();

    // Step 4: Cleanup rate limiters
    console.log("Cleaning up rate limiters...");
    resources.nitterLimiter.destroy();
    resources.jobLimiter.destroy();

    console.log("Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
};

// Register signal handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default {
  port: Number(PORT),
  fetch: app.fetch,
  idleTimeout: SERVER_TIMEOUT,
};
