# Rate Limiter Utility

A production-ready rate limiting solution using lodash throttle, designed to handle thousands of concurrent requests with intelligent queuing, retry logic, and comprehensive metrics.

## Features

- **Throttled Execution**: Uses lodash throttle to control request rate
- **Concurrent Request Management**: Limits the number of simultaneous requests
- **Priority Queue**: Supports request prioritization
- **Automatic Retries**: Exponential backoff with jitter for failed requests
- **Timeout Handling**: Configurable timeout for long-running requests
- **Comprehensive Metrics**: Track success/failure rates, response times, and queue status
- **Event Callbacks**: Monitor errors, successes, and queue changes in real-time

## Usage

### Basic Example

```typescript
import { createRateLimiter } from "~/src/utils/rate-limiter";

const rateLimiter = createRateLimiter({
  requestsPerSecond: 2,
  maxConcurrent: 5,
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 60000,
});

const result = await rateLimiter.execute(async () => {
  return await fetchData();
});
```

### Advanced Example with Callbacks

```typescript
const rateLimiter = createRateLimiter({
  requestsPerSecond: 2,
  maxConcurrent: 5,
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 120000,
  onError: (error, retries) => {
    console.error(`Error (retry ${retries}):`, error.message);
  },
  onSuccess: (duration) => {
    console.log(`Request completed in ${duration}ms`);
  },
  onQueueChange: (queueSize) => {
    console.log(`Queue size: ${queueSize}`);
  },
});
```

### Handling Multiple Requests

```typescript
const usernames = ["user1", "user2", "user3", "user4", "user5"];

const results = await Promise.all(
  usernames.map((username) =>
    rateLimiter.execute(
      async () => {
        return await fetchUserData(username);
      },
      1, // priority
    ),
  ),
);
```

### Priority Requests

```typescript
// High priority request (executed first)
const criticalData = await rateLimiter.execute(
  async () => fetchCriticalData(),
  10,
);

// Normal priority request
const normalData = await rateLimiter.execute(async () => fetchNormalData(), 1);

// Low priority request
const backgroundData = await rateLimiter.execute(
  async () => fetchBackgroundData(),
  0,
);
```

## Configuration Options

| Option              | Type     | Default | Description                                                    |
| ------------------- | -------- | ------- | -------------------------------------------------------------- |
| `requestsPerSecond` | number   | 2       | Maximum requests per second                                    |
| `maxConcurrent`     | number   | 5       | Maximum concurrent requests                                    |
| `maxRetries`        | number   | 3       | Maximum retry attempts for failed requests                     |
| `retryDelay`        | number   | 1000    | Base delay (ms) between retries (uses exponential backoff)     |
| `timeout`           | number   | 60000   | Request timeout in milliseconds                                |
| `onError`           | function | -       | Callback for errors: `(error: Error, retries: number) => void` |
| `onSuccess`         | function | -       | Callback for successful requests: `(duration: number) => void` |
| `onQueueChange`     | function | -       | Callback for queue changes: `(queueSize: number) => void`      |

## Methods

### `execute<T>(fn: () => Promise<T>, priority?: number): Promise<T>`

Execute a function with rate limiting.

- `fn`: Async function to execute
- `priority`: Request priority (higher = executed first, default: 0)
- Returns: Promise resolving to the function's result

### `getMetrics(): RateLimiterMetrics`

Get current metrics.

```typescript
const metrics = rateLimiter.getMetrics();
console.log(metrics);
// {
//   totalRequests: 100,
//   successfulRequests: 95,
//   failedRequests: 5,
//   retriedRequests: 10,
//   averageResponseTime: 1234,
//   currentQueueSize: 5,
//   activeRequests: 3,
//   lastRequestTime: 1234567890
// }
```

### `getQueueSize(): number`

Get current queue size.

### `getActiveRequests(): number`

Get number of currently active requests.

### `clearQueue(): void`

Clear all pending requests in the queue.

### `waitForCompletion(): Promise<void>`

Wait for all requests to complete.

```typescript
await rateLimiter.waitForCompletion();
console.log("All requests completed");
```

## Retry Strategy

The rate limiter uses exponential backoff with jitter for retries:

1. **First retry**: `retryDelay * 2^0 + jitter` (e.g., 1000ms + random)
2. **Second retry**: `retryDelay * 2^1 + jitter` (e.g., 2000ms + random)
3. **Third retry**: `retryDelay * 2^2 + jitter` (e.g., 4000ms + random)

Jitter is a random value up to 30% of the backoff delay to prevent thundering herd problems.

## Integration with Hono API

```typescript
import { Hono } from "hono";

import { createRateLimiter } from "./utils/rate-limiter";

const app = new Hono();
const rateLimiter = createRateLimiter({
  requestsPerSecond: 2,
  maxConcurrent: 5,
});

app.get("/metrics", (c) => {
  return c.json(rateLimiter.getMetrics());
});

app.get("/data/:id", async (c) => {
  const id = c.req.param("id");

  const data = await rateLimiter.execute(async () => {
    return await fetchData(id);
  });

  return c.json(data);
});
```

## Performance Considerations

- **Queue Management**: The queue is sorted by priority and timestamp, ensuring fair execution
- **Memory Efficient**: Completed requests are removed from memory immediately
- **Non-Blocking**: Uses async/await and promises for non-blocking execution
- **Scalable**: Can handle thousands of requests with minimal overhead

## Best Practices

1. **Set appropriate rate limits**: Match your API provider's limits
2. **Use priority wisely**: Reserve high priority for critical requests
3. **Monitor metrics**: Use callbacks to track performance and errors
4. **Handle errors gracefully**: Implement proper error handling in your request functions
5. **Configure timeouts**: Set realistic timeouts based on expected response times
6. **Test under load**: Verify behavior with your expected request volume

## Example: Production Server

```typescript
import { Hono } from "hono";

import { createRateLimiter } from "./utils/rate-limiter";

const rateLimiter = createRateLimiter({
  requestsPerSecond: 2,
  maxConcurrent: 10,
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 120000,
  onError: (error, retries) => {
    console.error(
      `[${new Date().toISOString()}] Error (retry ${retries}):`,
      error.message,
    );
  },
  onSuccess: (duration) => {
    console.log(`[${new Date().toISOString()}] ✓ ${duration}ms`);
  },
});

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/metrics", (c) => {
  const metrics = rateLimiter.getMetrics();
  return c.json({
    ...metrics,
    queueSize: rateLimiter.getQueueSize(),
    activeRequests: rateLimiter.getActiveRequests(),
  });
});

app.get("/api/:resource", async (c) => {
  const resource = c.req.param("resource");

  try {
    const data = await rateLimiter.execute(
      async () => await fetchResource(resource),
      1,
    );
    return c.json(data);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

export default app;
```
