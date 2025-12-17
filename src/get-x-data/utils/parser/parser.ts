import * as cheerio from "cheerio";

type Author = {
  username: string;
  verification?: "business" | "blue";
  name?: string;
  profile_photo_url?: string;
};

type TweetMetrics = {
  comments: number;
  retweets: number;
  quotes: number;
  likes: number;
  views: number;
};

type BaseTweet = {
  author: Author;
  content: string;
  url: string;
  created_at: string;
  metrics: TweetMetrics;
};

type Tweet = BaseTweet & {
  kind: "tweet" | "retweet" | "quote";
  child?: Tweet;
};

type Profile = {
  username: string;
  verification?: "business" | "blue";
  name?: string;
  profile_photo_url?: string;
  bio?: string;
  profile_link: string;
  cover_photo_url?: string;
  registration_date: string;
};

type Stats = {
  tweets: number;
  following: number;
  followers: number;
  likes: number;
};

export const createAbsoluteUrl = (
  url?: string | null,
  baseURL?: string,
): string | undefined => {
  if (!url) return undefined;
  if (!baseURL) return url; // If no baseURL, return as-is (might already be absolute)
  try {
    return new URL(url, baseURL).toString();
  } catch {
    return undefined;
  }
};

export const extractText = (
  $: cheerio.CheerioAPI,
  selector: string,
): string => {
  return $(selector).first().text().trim();
};

export const extractNumber = (text: string): number => {
  return Number((text || "").replace(/[^0-9]/g, "")) || 0;
};

export const extractVerification = (
  element: cheerio.Cheerio<any>,
): "business" | "blue" | undefined => {
  const className = element.find(".verified-icon").attr("class") || "";
  if (className.includes("business")) return "business";
  if (className.includes("blue")) return "blue";
  return undefined;
};

export const parseProfile = (
  $: cheerio.CheerioAPI,
  baseURL?: string,
): Profile => {
  const bannerStyle = $(".profile-banner a").attr("style") || "";
  const coverMatch = bannerStyle.match(/url\(([^)]+)\)/);
  const cover_photo_url = coverMatch
    ? createAbsoluteUrl(coverMatch[1], baseURL)
    : undefined;

  return {
    username: extractText($, ".profile-card-username").replace(/^@/, ""),
    verification: extractVerification($(".profile-card-fullname")),
    name: extractText($, ".profile-card-fullname") || undefined,
    profile_photo_url:
      createAbsoluteUrl($(".profile-card-avatar img").attr("src"), baseURL) ||
      undefined,
    bio: extractText($, ".profile-bio") || undefined,
    profile_link: $(".profile-website a").attr("href") || "",
    cover_photo_url,
    registration_date:
      $(".profile-joindate span").attr("title") ||
      extractText($, ".profile-joindate"),
  };
};

export const parseStats = ($: cheerio.CheerioAPI): Stats => {
  return {
    tweets: extractNumber(
      $(".profile-statlist .posts .profile-stat-num").text(),
    ),
    following: extractNumber(
      $(".profile-statlist .following .profile-stat-num").text(),
    ),
    followers: extractNumber(
      $(".profile-statlist .followers .profile-stat-num").text(),
    ),
    likes: extractNumber(
      $(".profile-statlist .likes .profile-stat-num").text(),
    ),
  };
};

const parseAuthor = (root: cheerio.Cheerio<any>, baseURL?: string): Author => {
  return {
    username: root.find(".username").first().text().trim().replace(/^@/, ""),
    verification: extractVerification(root),
    name: root.find(".fullname").first().text().trim() || undefined,
    profile_photo_url:
      createAbsoluteUrl(root.find(".tweet-avatar img").attr("src"), baseURL) ||
      undefined,
  };
};

const extractStatValue = (
  statsRoot: cheerio.Cheerio<any>,
  iconClass: string,
): number => {
  const element = statsRoot.find(`.${iconClass}`).first();
  const textValue = element.closest(".tweet-stat").text();
  return extractNumber(textValue);
};

const parseBaseTweet = (
  $: cheerio.CheerioAPI,
  item: cheerio.Cheerio<any>,
  baseURL?: string,
): BaseTweet | null => {
  const body = item.find(".tweet-body").first();
  if (body.length === 0) return null;

  const header = body.find(".tweet-header").first();
  const statsRoot = body.find(".tweet-stats").first();
  const linkHref = item.find(".tweet-link").attr("href") || "";
  const createdTitle =
    header.find(".tweet-date a").attr("title") ||
    header.find(".tweet-date a").text();

  return {
    author: parseAuthor(header, baseURL),
    content: body.find(".tweet-content").text().trim(),
    url: createAbsoluteUrl(linkHref, baseURL) || "",
    created_at: createdTitle,
    metrics: {
      comments: extractStatValue(statsRoot, "icon-comment"),
      retweets: extractStatValue(statsRoot, "icon-retweet"),
      quotes: extractStatValue(statsRoot, "icon-quote"),
      likes: extractStatValue(statsRoot, "icon-heart"),
      views:
        extractStatValue(statsRoot, "icon-view") ||
        extractStatValue(statsRoot, "icon-play"),
    },
  };
};

const parseQuoteTweet = (
  $: cheerio.CheerioAPI,
  baseTweet: BaseTweet,
  body: cheerio.Cheerio<any>,
  baseURL?: string,
): Tweet => {
  const quoteRoot = body.find(".quote, .quoted-tweet").first();
  const qHeader = quoteRoot;

  const qAuthor: Author = {
    username: qHeader.find(".username").first().text().trim().replace(/^@/, ""),
    verification: extractVerification(qHeader),
    name: qHeader.find(".fullname").first().text().trim() || undefined,
    profile_photo_url:
      createAbsoluteUrl(qHeader.find("img").attr("src"), baseURL) || undefined,
  };

  const qUrl =
    createAbsoluteUrl(
      qHeader.find("a[href*='/status/']").attr("href"),
      baseURL,
    ) || baseTweet.url;
  const qContent = qHeader.text().trim();

  const child: Tweet = {
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
};

const parseRetweet = (baseTweet: BaseTweet, profile: Profile): Tweet => {
  const parentAuthor: Author = {
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
};

export const parseTweets = (
  $: cheerio.CheerioAPI,
  profile: Profile,
  baseURL?: string,
): Tweet[] => {
  return $(".timeline .timeline-item")
    .map((_, item) => {
      const it = $(item);
      if (it.hasClass("show-more")) return null;

      const baseTweet = parseBaseTweet($, it, baseURL);
      if (!baseTweet) return null;

      const body = it.find(".tweet-body").first();
      const isRetweet = body.find(".retweet-header").length > 0;
      const hasQuote = body.find(".quote, .quoted-tweet").first().length > 0;

      if (isRetweet) {
        return parseRetweet(baseTweet, profile);
      }

      if (hasQuote) {
        return parseQuoteTweet($, baseTweet, body, baseURL);
      }

      return { ...baseTweet, kind: "tweet" } as Tweet;
    })
    .get()
    .filter((tweet): tweet is Tweet => tweet !== null);
};
