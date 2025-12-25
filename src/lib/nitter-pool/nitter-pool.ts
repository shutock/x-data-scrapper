import * as cheerio from "cheerio";

import {
  ENABLE_THOROUGH_HEALTH_CHECKS,
  HEALTH_CHECK_TIMEOUT_MS,
  UNHEALTHY_INSTANCE_RETRY_PROBABILITY,
} from "~/src/lib/constants";

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
  "https://nitter.net", // 🇳🇱 Official, 94% uptime - INCONSISTENT (returns partial results)
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

    const shouldRetryUnhealthy =
      Math.random() < UNHEALTHY_INSTANCE_RETRY_PROBABILITY;

    const candidateInstances = Array.from(this.instances.values()).filter(
      (instance) => {
        // Filter out rate-limited instances that haven't cooled down
        if (
          instance.status === "rate_limited" &&
          instance.rateLimitedUntil &&
          now < instance.rateLimitedUntil
        ) {
          return false;
        }

        // Include unhealthy instances only probabilistically or when no healthy ones exist
        if (instance.status === "unhealthy" && !shouldRetryUnhealthy) {
          return false;
        }

        return true;
      },
    );

    if (candidateInstances.length === 0) {
      throw new Error(
        "No healthy Nitter instances available. All instances are down or rate-limited.",
      );
    }

    // Round-robin selection
    const selectedInstance =
      candidateInstances[this.currentIndex % candidateInstances.length];

    if (!selectedInstance) {
      throw new Error("Failed to select instance");
    }

    this.currentIndex = (this.currentIndex + 1) % candidateInstances.length;

    // Log if we're retrying an unhealthy instance
    if (selectedInstance.status === "unhealthy") {
      console.warn(
        `[NitterPool] Retrying unhealthy instance ${selectedInstance.url} (${UNHEALTHY_INSTANCE_RETRY_PROBABILITY * 100}% chance)`,
      );
    }

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
      // Fetch test user profile with configurable timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        HEALTH_CHECK_TIMEOUT_MS,
      );

      const response = await fetch(`${url}/elonmusk`, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;

      if (!response.ok || response.status !== 200) {
        return {
          url,
          healthy: false,
          responseTime,
          error: `HTTP ${response.status}`,
        };
      }

      // If thorough health checks disabled, just check status code
      if (!ENABLE_THOROUGH_HEALTH_CHECKS) {
        return {
          url,
          healthy: true,
          responseTime,
        };
      }

      // Thorough check: Verify content contains tweets and is parseable
      const html = await response.text();

      // Try to parse the page to ensure parser works
      try {
        const $ = cheerio.load(html);

        // Check for Nitter-specific HTML structure
        const hasTimeline = $(".timeline").length > 0;
        const hasTimelineItems = $(".timeline .timeline-item").length > 0;
        const hasProfileCard = $(".profile-card").length > 0;

        if (!hasTimeline || !hasTimelineItems || !hasProfileCard) {
          return {
            url,
            healthy: false,
            responseTime,
            error: `Missing structure: timeline=${hasTimeline}, items=${hasTimelineItems}, profile=${hasProfileCard}`,
          };
        }

        const tweetCount = $(".timeline .timeline-item").length;

        if (tweetCount === 0) {
          return {
            url,
            healthy: false,
            responseTime,
            error: "No tweets found in timeline",
          };
        }

        // Try to parse profile to ensure parser works
        const profileUsername = $(".profile-card-username")
          .first()
          .text()
          .trim()
          .replace(/^@/, "");

        if (!profileUsername || profileUsername.length === 0) {
          return {
            url,
            healthy: false,
            responseTime,
            error: "Failed to parse profile username",
          };
        }

        // Instance is fully functional
        console.log(
          `[NitterPool] Health check passed for ${url}: ${tweetCount} tweets, username: ${profileUsername}`,
        );

        return {
          url,
          healthy: true,
          responseTime,
        };
      } catch (parseError) {
        return {
          url,
          healthy: false,
          responseTime,
          error: `Parse error: ${parseError instanceof Error ? parseError.message : "unknown"}`,
        };
      }
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
