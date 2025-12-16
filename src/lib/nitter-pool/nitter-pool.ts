import type {
  HealthCheckResult,
  InstanceStatus,
  NitterInstance,
} from "./types";

const DEFAULT_INSTANCES = [
  "https://nitter.tiekoetter.com", // 🇩🇪 94% uptime, 15ms avg - RELIABLE
  "https://nitter.privacyredirect.com", // 🇫🇮 94% uptime, RSS - RELIABLE
  // "https://xcancel.com", // 🇺🇸 98% uptime, 711ms avg - DOWN (503)
  // "https://nitter.poast.org", // 🇺🇸 85% uptime - UNRELIABLE
  // "https://nitter.net", // 🇳🇱 Official, 94% uptime - INCONSISTENT (returns partial results)
  // "https://nuku.trabun.org", // 🇨🇱 95% uptime - UNRELIABLE
  // "https://nitter.space", // 🇺🇸 96% uptime - UNRELIABLE
  // "https://lightbrd.com", // 🇹🇷 95% uptime - UNRELIABLE
  // "https://nitter.catsarch.com", // 🇺🇸/🇩🇪 56% uptime (backup) - VERY UNRELIABLE
];

export class NitterInstancePool {
  private instances: Map<string, NitterInstance>;
  private currentIndex: number = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private maxConsecutiveFailures: number = 3;

  constructor(instanceUrls?: string[]) {
    const urls = instanceUrls || DEFAULT_INSTANCES;
    this.instances = new Map();

    for (const url of urls) {
      this.instances.set(url, {
        url,
        status: "healthy",
        consecutiveFailures: 0,
        lastChecked: 0,
        avgResponseTime: 0,
        rateLimitedUntil: null,
      });
    }
  }

  async initialize(): Promise<void> {
    console.log(
      `[NitterPool] Initializing pool with ${this.instances.size} instances...`,
    );

    // Run parallel health checks on all instances (5s timeout each)
    await this.refreshHealthChecks();

    const healthyCount = Array.from(this.instances.values()).filter(
      (i) => i.status === "healthy",
    ).length;

    console.log(
      `[NitterPool] Initialization complete: ${healthyCount}/${this.instances.size} instances healthy`,
    );

    if (healthyCount === 0) {
      console.warn(
        "[NitterPool] WARNING: No healthy instances available. Service may be unstable.",
      );
    }
  }

  getHealthyInstance(_sessionId?: string): string {
    const now = Date.now();
    const healthyInstances = Array.from(this.instances.values()).filter(
      (instance) => {
        // Filter out unhealthy instances
        if (instance.status === "unhealthy") return false;

        // Filter out rate-limited instances that haven't cooled down
        if (
          instance.status === "rate_limited" &&
          instance.rateLimitedUntil &&
          now < instance.rateLimitedUntil
        ) {
          return false;
        }

        return true;
      },
    );

    if (healthyInstances.length === 0) {
      throw new Error(
        "No healthy Nitter instances available. All instances are down or rate-limited.",
      );
    }

    // Round-robin selection
    const selectedInstance =
      healthyInstances[this.currentIndex % healthyInstances.length];

    if (!selectedInstance) {
      throw new Error("Failed to select instance");
    }

    this.currentIndex = (this.currentIndex + 1) % healthyInstances.length;

    return selectedInstance.url;
  }

  markInstanceFailed(url: string, isRateLimit: boolean = false): void {
    const instance = this.instances.get(url);
    if (!instance) return;

    instance.consecutiveFailures++;

    if (isRateLimit) {
      instance.status = "rate_limited";
      // Set cooldown: 90 seconds + random jitter (0-20s)
      const cooldownMs = (90 + Math.random() * 20) * 1000;
      instance.rateLimitedUntil = Date.now() + cooldownMs;

      console.warn(
        `[NitterPool] Instance ${url} rate-limited. Cooldown until ${new Date(instance.rateLimitedUntil).toISOString()}`,
      );
    } else if (instance.consecutiveFailures >= this.maxConsecutiveFailures) {
      instance.status = "unhealthy";
      console.error(
        `[NitterPool] Instance ${url} marked unhealthy after ${instance.consecutiveFailures} failures`,
      );
    } else {
      console.warn(
        `[NitterPool] Instance ${url} failed (${instance.consecutiveFailures}/${this.maxConsecutiveFailures})`,
      );
    }
  }

  markInstanceSuccess(url: string, responseTime?: number): void {
    const instance = this.instances.get(url);
    if (!instance) return;

    // Reset failure counter
    instance.consecutiveFailures = 0;

    // Update status if it was rate-limited or unhealthy
    if (instance.status !== "healthy") {
      console.log(`[NitterPool] Instance ${url} recovered, marking healthy`);
      instance.status = "healthy";
      instance.rateLimitedUntil = null;
    }

    // Update average response time
    if (responseTime !== undefined) {
      if (instance.avgResponseTime === 0) {
        instance.avgResponseTime = responseTime;
      } else {
        // Exponential moving average
        instance.avgResponseTime =
          instance.avgResponseTime * 0.8 + responseTime * 0.2;
      }
    }
  }

  getHealthStatus(): Array<{
    url: string;
    status: InstanceStatus;
    consecutiveFailures: number;
    avgResponseTime: number;
    rateLimitedUntil: string | null;
  }> {
    return Array.from(this.instances.values()).map((instance) => ({
      url: instance.url,
      status: instance.status,
      consecutiveFailures: instance.consecutiveFailures,
      avgResponseTime: Math.round(instance.avgResponseTime),
      rateLimitedUntil: instance.rateLimitedUntil
        ? new Date(instance.rateLimitedUntil).toISOString()
        : null,
    }));
  }

  private async healthCheck(url: string): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Try to fetch a test user profile with 5s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${url}/elonmusk`, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;
      const healthy = response.ok && response.status === 200;

      // Basic validation: check if response looks like HTML
      if (healthy) {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/html")) {
          return {
            url,
            healthy: false,
            responseTime,
            error: "Invalid content type",
          };
        }
      }

      return {
        url,
        healthy,
        responseTime,
        error: healthy ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        url,
        healthy: false,
        responseTime,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async refreshHealthChecks(): Promise<void> {
    const urls = Array.from(this.instances.keys());

    // Run health checks in parallel
    const results = await Promise.all(urls.map((url) => this.healthCheck(url)));

    for (const result of results) {
      const instance = this.instances.get(result.url);
      if (!instance) continue;

      instance.lastChecked = Date.now();

      if (result.healthy) {
        // Reset failures and mark healthy
        instance.consecutiveFailures = 0;
        instance.status = "healthy";
        instance.rateLimitedUntil = null;
        instance.avgResponseTime = result.responseTime;
      } else {
        // Increment failures
        instance.consecutiveFailures++;

        if (instance.consecutiveFailures >= this.maxConsecutiveFailures) {
          instance.status = "unhealthy";
        }

        console.warn(
          `[NitterPool] Health check failed for ${result.url}: ${result.error}`,
        );
      }
    }
  }

  startPeriodicHealthChecks(intervalMs: number = 300000): void {
    if (this.healthCheckInterval) {
      return; // Already started
    }

    console.log(
      `[NitterPool] Starting periodic health checks every ${intervalMs / 1000}s`,
    );

    this.healthCheckInterval = setInterval(() => {
      this.refreshHealthChecks().catch((error) => {
        console.error("[NitterPool] Health check error:", error);
      });
    }, intervalMs);
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log("[NitterPool] Stopped periodic health checks");
    }
  }
}
