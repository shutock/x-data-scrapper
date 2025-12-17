import type { Ora } from "ora";
import type { HTTPResponse, Page } from "puppeteer";
import * as cheerio from "cheerio";
import { z } from "zod";

import type { BrowserPool } from "~/src/lib/browser-pool";
import type { RateLimiter } from "~/src/lib/rate-limiter";
import {
  DELAY_BETWEEN_PAGES,
  RATE_LIMITER_MAX_CONCURRENT,
  RATE_LIMITER_MAX_RETRIES,
  RATE_LIMITER_REQUESTS_PER_SECOND,
  RATE_LIMITER_RETRY_DELAY,
  RATE_LIMITER_TIMEOUT,
} from "~/src/lib/constants";
import { createRateLimiter } from "~/src/lib/rate-limiter";

import { schema } from "./schema";
import {
  BrowserError,
  getPageHTML,
  getPageInfo,
  handleError,
  navigateToNextPage,
  navigateToPage,
  parseProfile,
  parseStats,
  parseTweets,
  shouldStopPagination,
} from "./utils";

type GetDataOptions = {
  tweetsLimit?: number;
  ora?: Ora;
  delayBetweenPages?: number;
  maxRetries?: number;
  rateLimiter?: RateLimiter;
  sessionId?: string;
  baseURL?: string;
  browserPool?: BrowserPool;
  onProgress?: (currentData: any) => void;
};

type InternalGetDataOptions = {
  tweetsLimit: number;
  ora?: Ora;
  delayBetweenPages: number;
  maxRetries: number;
  rateLimiter: RateLimiter;
  sessionId?: string;
  baseURL: string;
  browserPool: BrowserPool;
  onProgress?: (currentData: any) => void;
};

type TweetCollectionState = {
  allTweets: any[];
  seenUrls: Set<string>;
  consecutiveNoNewTweets: number;
  seenCursors: Set<string>;
};

const createInitialState = (): TweetCollectionState => ({
  allTweets: [],
  seenUrls: new Set<string>(),
  consecutiveNoNewTweets: 0,
  seenCursors: new Set<string>(),
});

const addNewTweets = (state: TweetCollectionState, tweets: any[]): void => {
  const newTweets = tweets.filter(
    (tweet) => tweet && !state.seenUrls.has(tweet.url),
  );

  newTweets.forEach((tweet) => {
    state.seenUrls.add(tweet.url);
  });

  state.allTweets.push(...newTweets);

  if (newTweets.length === 0) {
    state.consecutiveNoNewTweets++;
  } else {
    state.consecutiveNoNewTweets = 0;
  }
};

const shouldStopCollection = (
  state: TweetCollectionState,
  tweetsLimit: number,
): boolean => {
  if (state.allTweets.length >= tweetsLimit) {
    return true;
  }

  // Increased from 3 to 5 for better reliability
  if (state.consecutiveNoNewTweets >= 5) {
    return true;
  }

  return false;
};

const collectTweetsFromPage = async (
  browserPool: BrowserPool,
  username: string,
  options: InternalGetDataOptions,
): Promise<any> => {
  const {
    tweetsLimit,
    ora,
    delayBetweenPages,
    maxRetries,
    rateLimiter,
    sessionId = "default",
    baseURL,
  } = options;

  // Execute scraping inside browser pool
  return await browserPool.execute(async (page: Page) => {
    const url = new URL(username, baseURL).toString();

    try {
      // Setup page
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      );

      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        const blockResources = [
          "image",
          "font",
          "stylesheet",
          "media",
          "other",
        ];
        if (blockResources.includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      page.on("response", (response: HTTPResponse) => {
        const headers = response.headers();
        rateLimiter.updateRateLimit(sessionId, headers);
      });

      await navigateToPage(page, url);
    } catch (error) {
      throw new BrowserError("Failed to create or navigate page", error);
    }

    const state = createInitialState();
    let profile: any;
    let stats: any;

    while (!shouldStopCollection(state, tweetsLimit)) {
      try {
        const html = await getPageHTML(page);
        const $ = cheerio.load(html);

        if (!profile) profile = parseProfile($);
        if (!stats) stats = parseStats($);

        const tweets = parseTweets($, profile);
        addNewTweets(state, tweets);

        // Report progress for timeout handling
        if (options.onProgress) {
          options.onProgress({
            profile,
            stats,
            tweets: state.allTweets.slice(0, tweetsLimit),
          });
        }

        if (shouldStopCollection(state, tweetsLimit)) break;

        const pageInfo = await getPageInfo(page);

        // Detect cursor loops to prevent infinite pagination
        if (pageInfo.linkHref && pageInfo.linkHref.includes("cursor=")) {
          const cursorMatch = pageInfo.linkHref.match(/cursor=([^&]+)/);
          if (cursorMatch && cursorMatch[1]) {
            const cursor = cursorMatch[1];
            if (state.seenCursors.has(cursor)) {
              if (ora) {
                ora.text = `Detected cursor loop, stopping pagination (${state.allTweets.length}/${tweetsLimit})`;
              }
              break;
            }
            state.seenCursors.add(cursor);
          }
        }

        if (ora) {
          ora.text = `Page check: showMore=${pageInfo.hasShowMore}, link=${pageInfo.hasLink}, href=${pageInfo.linkHref}, items=${pageInfo.itemCount} (${state.allTweets.length}/${tweetsLimit})`;
        }

        if (
          shouldStopPagination(
            pageInfo,
            username,
            ora,
            state.allTweets.length,
            tweetsLimit,
          )
        ) {
          break;
        }

        const navigationSuccess = await rateLimiter.execute(
          () =>
            navigateToNextPage(page, {
              delayBetweenPages,
              maxRetries,
              ora,
              currentCount: state.allTweets.length,
              totalLimit: tweetsLimit,
            }),
          0,
          sessionId,
        );

        if (!navigationSuccess) break;

        if (ora) {
          ora.text = `Loading more tweets... (${state.allTweets.length}/${tweetsLimit})`;
        }
      } catch (error) {
        handleError(error, "Error collecting tweets from page");
      }
    }

    // Browser pool handles page cleanup
    return {
      profile,
      stats,
      tweets: state.allTweets.slice(0, tweetsLimit),
    };
  });
};

export const getXData = async (
  username: string,
  options: GetDataOptions = {},
): Promise<z.infer<typeof schema>> => {
  const {
    ora,
    tweetsLimit = 100,
    delayBetweenPages = DELAY_BETWEEN_PAGES,
    maxRetries = 3,
    sessionId,
    baseURL = "https://nitter.net",
    browserPool,
    onProgress,
  } = options;

  if (!browserPool) {
    throw new Error("browserPool is required");
  }

  const rateLimiter =
    options.rateLimiter ||
    createRateLimiter({
      requestsPerSecond: Math.min(
        1000 / delayBetweenPages,
        RATE_LIMITER_REQUESTS_PER_SECOND,
      ),
      maxConcurrent: RATE_LIMITER_MAX_CONCURRENT,
      maxRetries: RATE_LIMITER_MAX_RETRIES,
      retryDelay: RATE_LIMITER_RETRY_DELAY,
      timeout: RATE_LIMITER_TIMEOUT,
    });

  const url = new URL(username, baseURL).toString();
  ora?.start(`Fetching ${url}`);

  try {
    const data = await collectTweetsFromPage(browserPool, username, {
      tweetsLimit,
      ora,
      delayBetweenPages,
      maxRetries,
      rateLimiter,
      sessionId,
      baseURL,
      browserPool,
      onProgress,
    });

    const parsed = schema.parse(data);
    return parsed;
  } catch (error) {
    ora?.fail("Failed to fetch page");
    throw error;
  } finally {
    if (!options.rateLimiter) {
      rateLimiter.destroy();
    }
  }
};
