const env = process.env;
export const PORT = Number(env.PORT ?? 1337);
export const POSTS_LIMIT = Number(env.POSTS_LIMIT ?? 100);
export const DELAY_BETWEEN_PAGES = Number(env.DELAY_BETWEEN_PAGES ?? 4000);
export const MAX_RETRIES = Number(env.MAX_RETRIES ?? 3);
export const RATE_LIMITER_REQUESTS_PER_SECOND = Number(
  env.RATE_LIMITER_REQUESTS_PER_SECOND ?? 2,
);
export const RATE_LIMITER_MAX_CONCURRENT = Number(
  env.RATE_LIMITER_MAX_CONCURRENT ?? 5,
);
export const RATE_LIMITER_MAX_RETRIES = Number(
  env.RATE_LIMITER_MAX_RETRIES ?? 3,
);
export const RATE_LIMITER_RETRY_DELAY = Number(
  env.RATE_LIMITER_RETRY_DELAY ?? 2000,
);
export const RATE_LIMITER_TIMEOUT = Number(env.RATE_LIMITER_TIMEOUT ?? 120000);
