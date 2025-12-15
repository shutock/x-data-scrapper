import * as cheerio from "cheerio";
import { random } from "lodash";
import { type Ora } from "ora";
import puppeteer from "puppeteer";

import { schema } from "./schema";

const baseURL = "https://nitter.net";

export const getData = async (
  username: string,
  {
    ora,
    postsLimit = 100,
    delayBetweenPages = 2000,
    maxRetries = 3,
  }: {
    postsLimit?: number;
    ora?: Ora;
    delayBetweenPages?: number;
    maxRetries?: number;
  },
) => {
  const url = new URL(username, baseURL).toString();
  ora?.start(`Fetching ${url}`);

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      {
        architecture: "x86",
        mobile: false,
        platform: "macOS",
        platformVersion: "10.15.7",
        fullVersion: "127.0.0.0",
        model: "",
        wow64: false,
      },
    );
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const t = req.resourceType();
      if (t === "image" || t === "font") req.abort();
      else req.continue();
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForFunction(
      () => (globalThis as any).document?.body?.children?.length > 0,
      { timeout: 30000 },
    );

    const allTweets: any[] = [];
    const seenUrls = new Set<string>();
    let profile: any;
    let stats: any;
    let consecutiveNoNewTweets = 0;

    while (allTweets.length < postsLimit) {
      let html = await page.evaluate(
        () => (globalThis as any).document?.body?.outerHTML || "",
      );

      if (!html || html.trim().length === 0) {
        html = await page.content();
      }

      const $ = cheerio.load(html);
      const abs = (u?: string | null) => {
        if (!u) return undefined;
        try {
          return new URL(u, baseURL).toString();
        } catch {
          return undefined;
        }
      };
      const text = (sel: string) => $(sel).first().text().trim();
      const num = (s: string) => Number((s || "").replace(/[^0-9]/g, "")) || 0;
      const verificationFrom = (el: cheerio.Cheerio<any>) => {
        const cls = el.find(".verified-icon").attr("class") || "";
        if (cls.includes("business")) return "business" as const;
        if (cls.includes("blue")) return "blue" as const;
        return undefined;
      };

      if (!profile) {
        const bannerStyle = $(".profile-banner a").attr("style") || "";
        const coverMatch = bannerStyle.match(/url\(([^)]+)\)/);
        const cover_photo_url = coverMatch ? abs(coverMatch[1]) : undefined;
        profile = {
          username: text(".profile-card-username").replace(/^@/, ""),
          verification: verificationFrom($(".profile-card-fullname")),
          name: text(".profile-card-fullname") || undefined,
          profile_photo_url:
            abs($(".profile-card-avatar img").attr("src")) || undefined,
          bio: text(".profile-bio") || undefined,
          profile_link: $(".profile-website a").attr("href") || "",
          cover_photo_url,
          registration_date:
            $(".profile-joindate span").attr("title") ||
            text(".profile-joindate"),
        };
      }

      if (!stats) {
        stats = {
          tweets: num($(".profile-statlist .posts .profile-stat-num").text()),
          following: num(
            $(".profile-statlist .following .profile-stat-num").text(),
          ),
          followers: num(
            $(".profile-statlist .followers .profile-stat-num").text(),
          ),
          likes: num($(".profile-statlist .likes .profile-stat-num").text()),
        };
      }

      const toAuthor = (root: cheerio.Cheerio<any>) => ({
        username: root
          .find(".username")
          .first()
          .text()
          .trim()
          .replace(/^@/, ""),
        verification: verificationFrom(root),
        name: root.find(".fullname").first().text().trim() || undefined,
        profile_photo_url:
          abs(root.find(".tweet-avatar img").attr("src")) || undefined,
      });
      const statVal = (statsRoot: cheerio.Cheerio<any>, icon: string) => {
        const el = statsRoot.find(`.${icon}`).first();
        const textVal = el.closest(".tweet-stat").text();
        return num(textVal);
      };
      const tweets = $(".timeline .timeline-item")
        .map((_, item) => {
          const it = $(item);
          if (it.hasClass("show-more")) return null;

          const body = it.find(".tweet-body").first();
          if (body.length === 0) return null;

          const header = body.find(".tweet-header").first();
          const statsRoot = body.find(".tweet-stats").first();
          const linkHref = it.find(".tweet-link").attr("href") || "";
          const createdTitle =
            header.find(".tweet-date a").attr("title") ||
            header.find(".tweet-date a").text();
          const baseTweet = {
            author: toAuthor(header),
            content: body.find(".tweet-content").text().trim(),
            url: abs(linkHref) || "",
            created_at: createdTitle,
            metrics: {
              comments: statVal(statsRoot, "icon-comment"),
              retweets: statVal(statsRoot, "icon-retweet"),
              quotes: statVal(statsRoot, "icon-quote"),
              likes: statVal(statsRoot, "icon-heart"),
              views:
                statVal(statsRoot, "icon-view") ||
                statVal(statsRoot, "icon-play"),
            },
          };

          const isRetweet = body.find(".retweet-header").length > 0;
          const quoteRoot = body.find(".quote, .quoted-tweet").first();
          const hasQuote = quoteRoot.length > 0;

          if (isRetweet) {
            const parentAuthor = {
              username: profile.username,
              verification: profile.verification,
              name: profile.name,
              profile_photo_url: profile.profile_photo_url,
            };
            return {
              author: parentAuthor,
              content: "",
              url: baseTweet.url,
              created_at: baseTweet.created_at,
              metrics: baseTweet.metrics,
              kind: "retweet",
              child: { ...baseTweet, kind: "tweet" },
            };
          }

          if (hasQuote) {
            const qHeader = quoteRoot;
            const qAuthor = {
              username: qHeader
                .find(".username")
                .first()
                .text()
                .trim()
                .replace(/^@/, ""),
              verification: verificationFrom(qHeader),
              name:
                qHeader.find(".fullname").first().text().trim() || undefined,
              profile_photo_url:
                abs(qHeader.find("img").attr("src")) || undefined,
            };
            const qUrl =
              abs(qHeader.find("a[href*='/status/']").attr("href")) ||
              baseTweet.url;
            const qContent = qHeader.text().trim();
            const child = {
              author: qAuthor,
              content: qContent,
              url: qUrl,
              created_at: baseTweet.created_at,
              metrics: {
                comments: 0,
                retweets: 0,
                quotes: 0,
                likes: 0,
                views: 0,
              },
              kind: "tweet",
            };
            return { ...baseTweet, kind: "quote", child };
          }

          return { ...baseTweet, kind: "tweet" };
        })
        .get();

      const newTweets = (tweets as any[]).filter(
        (tweet) => tweet && !seenUrls.has(tweet.url),
      );
      newTweets.forEach((tweet) => {
        seenUrls.add(tweet.url);
      });

      allTweets.push(...newTweets);

      if (allTweets.length >= postsLimit) {
        break;
      }

      if (newTweets.length === 0) {
        consecutiveNoNewTweets++;
        if (consecutiveNoNewTweets >= 3) {
          break;
        }
      } else {
        consecutiveNoNewTweets = 0;
      }

      const pageInfo = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const showMoreDivs = doc.querySelectorAll(".timeline .show-more");
        const showMoreDiv = showMoreDivs[showMoreDivs.length - 1];
        const timelineItems = doc.querySelectorAll(".timeline .timeline-item");
        const link = showMoreDiv?.querySelector("a");
        return {
          hasShowMore: !!showMoreDiv,
          itemCount: timelineItems.length,
          hasLink: !!link,
          linkHref: link?.getAttribute("href") || null,
        };
      });

      if (ora) {
        ora.text = `Page check: showMore=${pageInfo.hasShowMore}, link=${pageInfo.hasLink}, href=${pageInfo.linkHref}, items=${pageInfo.itemCount} (${allTweets.length}/${postsLimit})`;
      }

      if (!pageInfo.hasShowMore) {
        if (ora) {
          ora.text = `Pagination stopped: no-show-more-div, items=${pageInfo.itemCount} (${allTweets.length}/${postsLimit})`;
        }
        break;
      }

      if (!pageInfo.linkHref) {
        if (ora) {
          ora.text = `Pagination stopped: no-link-href (${allTweets.length}/${postsLimit})`;
        }
        break;
      }

      if (
        pageInfo.linkHref === `/${username}` ||
        pageInfo.linkHref === username
      ) {
        if (ora) {
          ora.text = `Pagination stopped: link-to-profile (${allTweets.length}/${postsLimit})`;
        }
        break;
      }

      const randomDelay = random(
        delayBetweenPages * 0.8,
        delayBetweenPages * 1.5,
        false,
      );
      if (ora) {
        ora.text = `Rate limit delay (${Math.round(randomDelay)}ms)... (${allTweets.length}/${postsLimit})`;
      }
      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      let navigationSuccess = false;
      let retryCount = 0;

      while (!navigationSuccess && retryCount < maxRetries) {
        try {
          const currentUrl = page.url();
          const nextUrl = new URL(pageInfo.linkHref, currentUrl).toString();

          if (retryCount > 0) {
            const baseBackoff = delayBetweenPages * Math.pow(2, retryCount);
            const backoffDelay = Math.min(
              random(baseBackoff * 0.9, baseBackoff * 1.3, false),
              30000,
            );
            if (ora) {
              ora.text = `Retrying navigation (${retryCount}/${maxRetries}) after ${Math.round(backoffDelay)}ms... (${allTweets.length}/${postsLimit})`;
            }
            await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          }

          await page.goto(nextUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });

          await page.waitForSelector(".timeline .timeline-item", {
            timeout: 15000,
          });

          const postLoadDelay = random(1000, 2500, false);
          await new Promise((resolve) => setTimeout(resolve, postLoadDelay));
          navigationSuccess = true;
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            if (ora) {
              ora.text = `Pagination stopped after ${maxRetries} retries: ${error instanceof Error ? error.message : "unknown"} (${allTweets.length}/${postsLimit})`;
            }
            break;
          }
        }
      }

      if (!navigationSuccess) {
        break;
      }

      if (ora) {
        ora.text = `Loading more tweets... (${allTweets.length}/${postsLimit})`;
      }
    }

    const parsed = schema.parse({
      profile,
      stats,
      tweets: allTweets.slice(0, postsLimit),
    });

    return parsed;
  } catch (error) {
    ora?.fail("Failed to fetch page");
    throw error;
  } finally {
    await browser?.close();
  }
};
