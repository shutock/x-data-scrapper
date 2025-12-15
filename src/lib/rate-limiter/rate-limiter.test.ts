import { beforeEach, describe, expect, test } from "bun:test";

import { createRateLimiter, RateLimiter } from "../rate-limiter";

describe("RateLimiter", () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = createRateLimiter({
      requestsPerSecond: 10,
      maxConcurrent: 3,
      maxRetries: 2,
      retryDelay: 100,
      timeout: 5000,
    });
  });

  test("should create rate limiter with default config", () => {
    const limiter = createRateLimiter();
    expect(limiter).toBeInstanceOf(RateLimiter);
  });

  test("should execute single request successfully", async () => {
    const result = await rateLimiter.execute(async () => {
      return "success";
    });

    expect(result).toBe("success");
  });

  test("should handle multiple concurrent requests", async () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      rateLimiter.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return i;
      }),
    );

    const results = await Promise.all(requests);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("should respect max concurrent limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const requests = Array.from({ length: 10 }, () =>
      rateLimiter.execute(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 100));
        concurrent--;
        return true;
      }),
    );

    await Promise.all(requests);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  test("should retry failed requests", async () => {
    let attempts = 0;

    const result = await rateLimiter.execute(async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error("Temporary failure");
      }
      return "success";
    });

    expect(result).toBe("success");
    expect(attempts).toBe(2);
  });

  test("should fail after max retries", async () => {
    let attempts = 0;

    try {
      await rateLimiter.execute(async () => {
        attempts++;
        throw new Error("Persistent failure");
      });
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(attempts).toBe(3);
    }
  });

  test(
    "should handle timeout",
    async () => {
      const limiter = createRateLimiter({
        timeout: 100,
        maxRetries: 0,
      });

      try {
        await limiter.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return "should not reach here";
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Request timeout");
      }
    },
    { timeout: 10000 },
  );

  test("should prioritize high priority requests", async () => {
    const results: number[] = [];

    const lowPriorityRequests = Array.from({ length: 5 }, (_, i) =>
      rateLimiter.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        results.push(i);
        return i;
      }, 0),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const highPriorityRequest = rateLimiter.execute(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push(999);
      return 999;
    }, 10);

    await Promise.all([...lowPriorityRequests, highPriorityRequest]);

    const highPriorityIndex = results.indexOf(999);
    expect(highPriorityIndex).toBeLessThan(5);
  });

  test("should track metrics correctly", async () => {
    await rateLimiter.execute(async () => "success");

    const metrics = rateLimiter.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.successfulRequests).toBe(1);
    expect(metrics.failedRequests).toBe(0);
  });

  test("should clear queue", async () => {
    const requests = Array.from({ length: 10 }, () =>
      rateLimiter.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return true;
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    rateLimiter.clearQueue();

    const results = await Promise.allSettled(requests);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
  });

  test("should wait for completion", async () => {
    const requests = Array.from({ length: 5 }, () =>
      rateLimiter.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return true;
      }),
    );

    const waitPromise = rateLimiter.waitForCompletion();
    await Promise.all(requests);
    await waitPromise;

    expect(rateLimiter.getQueueSize()).toBe(0);
    expect(rateLimiter.getActiveRequests()).toBe(0);
  });

  test(
    "should handle errors in callbacks",
    async () => {
      let errorCallbackCalled = false;
      let successCallbackCalled = false;

      const limiter = createRateLimiter({
        maxRetries: 0,
        onError: () => {
          errorCallbackCalled = true;
        },
        onSuccess: () => {
          successCallbackCalled = true;
        },
      });

      await limiter.execute(async () => "success");
      expect(successCallbackCalled).toBe(true);

      try {
        await limiter.execute(async () => {
          throw new Error("test error");
        });
      } catch {}

      expect(errorCallbackCalled).toBe(true);
    },
    { timeout: 10000 },
  );

  test("should calculate average response time", async () => {
    await rateLimiter.execute(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return true;
    });

    await rateLimiter.execute(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return true;
    });

    const metrics = rateLimiter.getMetrics();
    expect(metrics.averageResponseTime).toBeGreaterThan(100);
    expect(metrics.averageResponseTime).toBeLessThan(250);
  });
});
