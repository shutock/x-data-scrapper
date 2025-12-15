import type { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer";

/**
 * Configuration options for browser and page creation
 */
type BrowserConfig = {
  /** Whether to run browser in headless mode */
  headless?: boolean;
  /** User agent string to use for the browser */
  userAgent?: string;
  /** Types of resources to block (e.g., 'image', 'font') */
  blockResources?: string[];
};

/**
 * Creates a new Puppeteer browser instance
 * @param config - Browser configuration options
 * @returns Promise resolving to a Browser instance
 */
export const createBrowser = async (
  config: BrowserConfig = {},
): Promise<Browser> => {
  const { headless = true } = config;

  const browser = await puppeteer.launch({ headless });
  return browser;
};

/**
 * Creates a new page with configured user agent and resource blocking
 * @param browser - The browser instance to create the page in
 * @param config - Page configuration options
 * @returns Promise resolving to a configured Page instance
 */
export const createPage = async (
  browser: Browser,
  config: BrowserConfig = {},
): Promise<Page> => {
  const {
    userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    blockResources = ["image", "font", "stylesheet", "media", "other"],
  } = config;

  const page = await browser.newPage();

  await page.setUserAgent(userAgent, {
    architecture: "x86",
    mobile: false,
    platform: "macOS",
    platformVersion: "10.15.7",
    fullVersion: "127.0.0.0",
    model: "",
    wow64: false,
  });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const resourceType = req.resourceType();
    if (blockResources.includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  return page;
};

/**
 * Navigates to a URL and waits for the page to load
 * @param page - The page instance to navigate
 * @param url - The URL to navigate to
 * @param timeout - Maximum time to wait for page load in milliseconds (default: 30000)
 * @throws {Error} If navigation or page load times out
 */
export const navigateToPage = async (
  page: Page,
  url: string,
  timeout = 30000,
): Promise<void> => {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout,
  });

  await Promise.race([
    page.waitForSelector(".timeline .timeline-item, .profile-card-username", {
      timeout: Math.min(2000, timeout),
    }),
    page.waitForFunction(
      () => (globalThis as any).document?.body?.children?.length > 0,
      { timeout },
    ),
  ]);
  await new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * 500) + 200),
  );
};
