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
