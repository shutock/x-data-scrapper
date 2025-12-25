const env = process.env;

export const PORT = Number(env.PORT ?? 1337);
export const POSTS_LIMIT = Number(env.POSTS_LIMIT ?? 100);
export const DELAY_BETWEEN_PAGES = Number(env.DELAY_BETWEEN_PAGES ?? 6000);
export const MAX_RETRIES = Number(env.MAX_RETRIES ?? 3);
export const RATE_LIMITER_REQUESTS_PER_SECOND = Number(
  env.RATE_LIMITER_REQUESTS_PER_SECOND ?? 1.5,
);
export const RATE_LIMITER_BURST_CAPACITY = Number(
  env.RATE_LIMITER_BURST_CAPACITY ?? 15,
);
export const RATE_LIMITER_MAX_CONCURRENT = Number(
  env.RATE_LIMITER_MAX_CONCURRENT ?? 1,
);
export const RATE_LIMITER_MAX_RETRIES = Number(
  env.RATE_LIMITER_MAX_RETRIES ?? 3,
);
export const RATE_LIMITER_RETRY_DELAY = Number(
  env.RATE_LIMITER_RETRY_DELAY ?? 2000,
);
export const RATE_LIMITER_TIMEOUT = Number(env.RATE_LIMITER_TIMEOUT ?? 120000);
export const SERVER_TIMEOUT = Number(env.SERVER_TIMEOUT ?? 255);
export const BROWSER_POOL_SIZE = Number(env.BROWSER_POOL_SIZE ?? 5);
export const NITTER_HEALTH_CHECK_INTERVAL = Number(
  env.NITTER_HEALTH_CHECK_INTERVAL ?? 300000,
);

// File Storage
export const SAVE_TO_FILE = env.SAVE_TO_FILE !== "false";

// Timeouts
export const SCRAPING_TIMEOUT_MS = Number(env.SCRAPING_TIMEOUT_MS ?? 300000); // 5 minutes
export const HEALTH_CHECK_TIMEOUT_MS = Number(
  env.HEALTH_CHECK_TIMEOUT_MS ?? 8000,
); // 8 seconds

// Instance Management
export const MAX_INSTANCE_RETRIES = Number(env.MAX_INSTANCE_RETRIES ?? 3);
export const INSTANCE_RETRY_DELAY_MS = Number(
  env.INSTANCE_RETRY_DELAY_MS ?? 1000,
);
export const UNHEALTHY_INSTANCE_RETRY_PROBABILITY = Number(
  env.UNHEALTHY_INSTANCE_RETRY_PROBABILITY ?? 0.15,
);

// Partial Results
export const PARTIAL_RESULTS_MIN_THRESHOLD = Number(
  env.PARTIAL_RESULTS_MIN_THRESHOLD ?? 0.2,
); // 20% minimum

// Feature Flags
export const ENABLE_THOROUGH_HEALTH_CHECKS =
  env.ENABLE_THOROUGH_HEALTH_CHECKS !== "false";

// User Agent
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

// Resource Blocking
export const BLOCKED_RESOURCE_TYPES = [
  "image",
  "font",
  "stylesheet",
  "media",
  "other",
];
