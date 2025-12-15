import * as cheerio from "cheerio";
import { type Ora } from "ora";
import { type Browser } from "puppeteer";
import { z } from "zod";

import { schema } from "./schema";
import {
  applyRateLimitDelay,
  BrowserError,
  createBrowser,
  createPage,
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

const baseURL = "https://nitter.net";

type GetDataOptions = {
  postsLimit?: number;
  ora?: Ora;
  delayBetweenPages?: number;
  maxRetries?: number;
};

type InternalGetDataOptions = {
  postsLimit: number;
  ora?: Ora;
  delayBetweenPages: number;
  maxRetries: number;
};

type TweetCollectionState = {
  allTweets: any[];
  seenUrls: Set<string>;
  consecutiveNoNewTweets: number;
};

const createInitialState = (): TweetCollectionState => ({
  allTweets: [],
  seenUrls: new Set<string>(),
  consecutiveNoNewTweets: 0,
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
  postsLimit: number,
): boolean => {
  if (state.allTweets.length >= postsLimit) {
    return true;
  }

  if (state.consecutiveNoNewTweets >= 3) {
    return true;
  }

  return false;
};

const collectTweetsFromPage = async (
  browser: Browser,
  username: string,
  options: InternalGetDataOptions,
): Promise<any> => {
  const { postsLimit, ora, delayBetweenPages, maxRetries } = options;
  const url = new URL(username, baseURL).toString();

  let page;
  try {
    page = await createPage(browser);
    await navigateToPage(page, url);
  } catch (error) {
    throw new BrowserError("Failed to create or navigate page", error);
  }

  const state = createInitialState();
  let profile: any;
  let stats: any;

  while (!shouldStopCollection(state, postsLimit)) {
    try {
      const html = await getPageHTML(page);
      const $ = cheerio.load(html);

      if (!profile) profile = parseProfile($);
      if (!stats) stats = parseStats($);

      const tweets = parseTweets($, profile);
      addNewTweets(state, tweets);

      if (shouldStopCollection(state, postsLimit)) break;

      const pageInfo = await getPageInfo(page);

      if (ora) {
        ora.text = `Page check: showMore=${pageInfo.hasShowMore}, link=${pageInfo.hasLink}, href=${pageInfo.linkHref}, items=${pageInfo.itemCount} (${state.allTweets.length}/${postsLimit})`;
      }

      if (
        shouldStopPagination(
          pageInfo,
          username,
          ora,
          state.allTweets.length,
          postsLimit,
        )
      ) {
        break;
      }

      await applyRateLimitDelay(
        delayBetweenPages,
        ora,
        state.allTweets.length,
        postsLimit,
      );

      const navigationSuccess = await navigateToNextPage(page, {
        delayBetweenPages,
        maxRetries,
        ora,
        currentCount: state.allTweets.length,
        totalLimit: postsLimit,
      });

      if (!navigationSuccess) break;

      if (ora) {
        ora.text = `Loading more tweets... (${state.allTweets.length}/${postsLimit})`;
      }
    } catch (error) {
      handleError(error, "Error collecting tweets from page");
    }
  }

  try {
    await page.close();
  } catch {}
  return {
    profile,
    stats,
    tweets: state.allTweets.slice(0, postsLimit),
  };
};

export const getXData = async (
  username: string,
  options: GetDataOptions = {},
): Promise<z.infer<typeof schema>> => {
  const {
    ora,
    postsLimit = 100,
    delayBetweenPages = 2000,
    maxRetries = 3,
  } = options;

  const url = new URL(username, baseURL).toString();
  ora?.start(`Fetching ${url}`);

  let browser: Browser | undefined;

  try {
    browser = await createBrowser();

    const data = await collectTweetsFromPage(browser, username, {
      postsLimit,
      ora,
      delayBetweenPages,
      maxRetries,
    });

    const parsed = schema.parse(data);
    return parsed;
  } catch (error) {
    ora?.fail("Failed to fetch page");
    throw error;
  } finally {
    await browser?.close();
  }
};
