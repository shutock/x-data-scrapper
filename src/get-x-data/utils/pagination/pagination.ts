import type { Ora } from "ora";
import type { Page } from "puppeteer";
import { random } from "lodash";

type PageInfo = {
  hasShowMore: boolean;
  itemCount: number;
  hasLink: boolean;
  linkHref: string | null;
  linkText: string | null;
};

type NavigationConfig = {
  delayBetweenPages: number;
  maxRetries: number;
  ora?: Ora;
  currentCount: number;
  totalLimit: number;
};

export const getPageInfo = async (page: Page): Promise<PageInfo> => {
  return await page.evaluate(() => {
    const doc = (globalThis as any).document;
    const showMoreDivs = Array.from(
      doc.querySelectorAll(".timeline .show-more"),
    ) as any[];

    // Prioritize finding a link with "cursor="
    const cursorDiv = showMoreDivs
      .slice()
      .reverse()
      .find((div) => {
        const href = div.querySelector("a")?.getAttribute("href");
        return href && href.includes("cursor=");
      });

    const showMoreDiv = cursorDiv || showMoreDivs[showMoreDivs.length - 1];
    const timelineItems = doc.querySelectorAll(".timeline .timeline-item");
    const link = showMoreDiv?.querySelector("a");
    return {
      hasShowMore: !!showMoreDiv,
      itemCount: timelineItems.length,
      hasLink: !!link,
      linkHref: link?.getAttribute("href") || null,
      linkText: link?.innerText || null,
    };
  });
};

export const shouldStopPagination = (
  pageInfo: PageInfo,
  username: string,
  ora?: Ora,
  currentCount = 0,
  totalLimit = 0,
): boolean => {
  if (!pageInfo.hasShowMore) {
    if (ora) {
      ora.text = `Pagination stopped: no-show-more-div, items=${pageInfo.itemCount} (${currentCount}/${totalLimit})`;
    }
    return true;
  }

  if (!pageInfo.linkHref) {
    if (ora) {
      ora.text = `Pagination stopped: no-link-href (${currentCount}/${totalLimit})`;
    }
    return true;
  }

  // Detect end-of-timeline messages
  const linkTextLower = (pageInfo.linkText || "").toLowerCase();
  if (
    linkTextLower.includes("no more") ||
    linkTextLower.includes("end of") ||
    linkTextLower.includes("no tweets")
  ) {
    if (ora) {
      ora.text = `Pagination stopped: end-of-timeline detected (${currentCount}/${totalLimit})`;
    }
    return true;
  }

  if (pageInfo.linkHref === `/${username}` || pageInfo.linkHref === username) {
    if (ora) {
      ora.text = `Pagination stopped: link-to-profile (text="${pageInfo.linkText}") (${currentCount}/${totalLimit})`;
    }
    return true;
  }

  if (pageInfo.linkHref && !/cursor=/.test(pageInfo.linkHref)) {
    if (ora) {
      ora.text = `Pagination stopped: no-cursor-link (${currentCount}/${totalLimit})`;
    }
    return true;
  }

  return false;
};

export const navigateToNextPage = async (
  page: Page,
  config: NavigationConfig,
): Promise<boolean> => {
  const { delayBetweenPages, maxRetries, ora, currentCount, totalLimit } =
    config;

  const pageInfo = await getPageInfo(page);

  if (!pageInfo.linkHref) {
    return false;
  }

  let navigationSuccess = false;
  let retryCount = 0;

  while (!navigationSuccess && retryCount < maxRetries) {
    try {
      const currentUrl = page.url();
      let nextUrl: string;

      try {
        nextUrl = new URL(pageInfo.linkHref, currentUrl).toString();
      } catch (urlError) {
        if (ora) {
          ora.text = `Invalid URL construction: href="${pageInfo.linkHref}", base="${currentUrl}" (${currentCount}/${totalLimit})`;
        }
        return false;
      }

      if (retryCount > 0) {
        const baseBackoff = delayBetweenPages * 2 ** retryCount;
        const backoffDelay = Math.min(
          random(baseBackoff * 0.9, baseBackoff * 1.3, false),
          30000,
        );
        if (ora) {
          ora.text = `Retrying navigation (${retryCount}/${maxRetries}) after ${Math.round(backoffDelay)}ms... (${currentCount}/${totalLimit})`;
        }
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }

      await page.goto(nextUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
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
          const errorMsg = error instanceof Error ? error.message : "unknown";
          ora.text = `Pagination stopped after ${maxRetries} retries: ${errorMsg} at ${page.url()} (${currentCount}/${totalLimit})`;
        }
        break;
      }
    }
  }

  return navigationSuccess;
};

export const getPageHTML = async (page: Page): Promise<string> => {
  let html = await page.evaluate(
    () => (globalThis as any).document?.body?.outerHTML || "",
  );

  if (!html || html.trim().length === 0) {
    html = await page.content();
  }

  return html;
};
