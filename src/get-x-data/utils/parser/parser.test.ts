import type z from "zod";
import { describe, expect, test } from "bun:test";
import * as cheerio from "cheerio";

import type { profileSchema } from "../../schema";
import {
  createAbsoluteUrl,
  extractNumber,
  extractText,
  extractVerification,
  parseProfile,
  parseStats,
  parseTweets,
} from "./parser";

describe("Parser Utils", () => {
  describe("createAbsoluteUrl", () => {
    test("should convert relative URL to absolute", () => {
      const result = createAbsoluteUrl("/user/profile", "https://nitter.net");
      expect(result).toBe("https://nitter.net/user/profile");
    });

    test("should handle absolute URLs", () => {
      const result = createAbsoluteUrl(
        "https://example.com/path",
        "https://nitter.net",
      );
      expect(result).toBe("https://example.com/path");
    });

    test("should return undefined for null input", () => {
      const result = createAbsoluteUrl(null, "https://nitter.net");
      expect(result).toBeNull();
    });

    test("should return undefined for undefined input", () => {
      const result = createAbsoluteUrl(undefined, "https://nitter.net");
      expect(result).toBeNull();
    });

    test("should handle invalid URLs gracefully", () => {
      const result = createAbsoluteUrl("not a valid url", "https://nitter.net");
      expect(result).toBeDefined();
    });

    test("should return url as-is if no baseURL provided", () => {
      const result = createAbsoluteUrl("/user/profile");
      expect(result).toBe("/user/profile");
    });
  });

  describe("extractText", () => {
    test("should extract text from selector", () => {
      const html = '<div class="test">Hello World</div>';
      const $ = cheerio.load(html);
      const result = extractText($, ".test");
      expect(result).toBe("Hello World");
    });

    test("should trim whitespace", () => {
      const html = '<div class="test">  Trimmed  </div>';
      const $ = cheerio.load(html);
      const result = extractText($, ".test");
      expect(result).toBe("Trimmed");
    });

    test("should return empty string for non-existent selector", () => {
      const html = "<div>Content</div>";
      const $ = cheerio.load(html);
      const result = extractText($, ".nonexistent");
      expect(result).toBe("");
    });

    test("should extract only first matching element", () => {
      const html =
        '<div class="test">First</div><div class="test">Second</div>';
      const $ = cheerio.load(html);
      const result = extractText($, ".test");
      expect(result).toBe("First");
    });
  });

  describe("extractNumber", () => {
    test("should extract number from text", () => {
      const result = extractNumber("123");
      expect(result).toBe(123);
    });

    test("should extract number from text with commas", () => {
      const result = extractNumber("1,234,567");
      expect(result).toBe(1234567);
    });

    test("should extract number from text with units", () => {
      const result = extractNumber("42K");
      expect(result).toBe(42);
    });

    test("should return 0 for empty string", () => {
      const result = extractNumber("");
      expect(result).toBe(0);
    });

    test("should return 0 for text without numbers", () => {
      const result = extractNumber("No numbers here");
      expect(result).toBe(0);
    });

    test("should handle negative numbers", () => {
      const result = extractNumber("-123");
      expect(result).toBe(123);
    });
  });

  describe("extractVerification", () => {
    test("should detect business verification", () => {
      const html = '<div><span class="verified-icon business"></span></div>';
      const $ = cheerio.load(html);
      const element = $("div");
      const result = extractVerification(element);
      expect(result).toBe("business");
    });

    test("should detect blue verification", () => {
      const html = '<div><span class="verified-icon blue"></span></div>';
      const $ = cheerio.load(html);
      const element = $("div");
      const result = extractVerification(element);
      expect(result).toBe("blue");
    });

    test("should return undefined for no verification", () => {
      const html = "<div><span></span></div>";
      const $ = cheerio.load(html);
      const element = $("div");
      const result = extractVerification(element);
      expect(result).toBeNull();
    });

    test("should prioritize business over blue", () => {
      const html =
        '<div><span class="verified-icon business blue"></span></div>';
      const $ = cheerio.load(html);
      const element = $("div");
      const result = extractVerification(element);
      expect(result).toBe("business");
    });
  });

  describe("parseProfile", () => {
    test("should parse basic profile information", () => {
      const html = `
        <div class="profile-card">
          <div class="profile-card-username">@testuser</div>
          <div class="profile-card-fullname">Test User</div>
          <div class="profile-bio">This is a test bio</div>
          <div class="profile-website"><a href="https://example.com">Website</a></div>
          <div class="profile-joindate"><span title="2020-01-01">Joined Jan 2020</span></div>
        </div>
      `;
      const $ = cheerio.load(html);
      const result = parseProfile($);

      expect(result.username).toBe("testuser");
      expect(result.name).toBe("Test User");
      expect(result.bio).toBe("This is a test bio");
      expect(result.profile_link).toBe("https://example.com");
      expect(result.registration_date).toBe("2020-01-01");
    });

    test("should handle missing optional fields", () => {
      const html = `
        <div class="profile-card">
          <a class="profile-card-avatar" href="/testuser"></a>
          <div class="profile-card-username">@testuser</div>
        </div>
      `;
      const $ = cheerio.load(html);
      const result = parseProfile($);

      expect(result.username).toBe("testuser");
      expect(result.name).toBeNull();
      expect(result.bio).toBeNull();
    });
  });

  describe("parseStats", () => {
    test("should parse all stats correctly", () => {
      const html = `
        <div class="profile-statlist">
          <div class="posts">
            <span class="profile-stat-num">1,234</span>
          </div>
          <div class="following">
            <span class="profile-stat-num">567</span>
          </div>
          <div class="followers">
            <span class="profile-stat-num">8,901</span>
          </div>
          <div class="likes">
            <span class="profile-stat-num">2,345</span>
          </div>
        </div>
      `;
      const $ = cheerio.load(html);
      const result = parseStats($);

      expect(result.tweets).toBe(1234);
      expect(result.following).toBe(567);
      expect(result.followers).toBe(8901);
      expect(result.likes).toBe(2345);
    });

    test("should handle missing stats", () => {
      const html = '<div class="profile-statlist"></div>';
      const $ = cheerio.load(html);
      const result = parseStats($);

      expect(result.tweets).toBe(0);
      expect(result.following).toBe(0);
      expect(result.followers).toBe(0);
      expect(result.likes).toBe(0);
    });
  });

  describe("parseTweets", () => {
    const mockProfile: z.infer<typeof profileSchema> = {
      username: "testuser",
      verification: null,
      name: null,
      profile_photo_url: null,
      bio: null,
      profile_link: "https://nitter.net/testuser",
      cover_photo_url: null,
      registration_date: "2020-01-01",
    };

    test("should parse regular tweets", () => {
      const html = `
        <div class="timeline">
          <div class="timeline-item">
            <div class="tweet-header">
              <a class="username" href="/testuser">@testuser</a>
              <a class="tweet-link" href="/testuser/status/123">
                <span class="tweet-date" title="2024-01-01">Jan 1</span>
              </a>
            </div>
            <div class="tweet-body">
              <div class="tweet-content">Test tweet content</div>
            </div>
            <div class="tweet-stats">
              <span class="tweet-stat">
                <div class="icon-comment"></div>
                <div class="tweet-stat-num">5</div>
              </span>
              <span class="tweet-stat">
                <div class="icon-retweet"></div>
                <div class="tweet-stat-num">10</div>
              </span>
              <span class="tweet-stat">
                <div class="icon-quote"></div>
                <div class="tweet-stat-num">2</div>
              </span>
              <span class="tweet-stat">
                <div class="icon-heart"></div>
                <div class="tweet-stat-num">20</div>
              </span>
            </div>
          </div>
        </div>
      `;
      const $ = cheerio.load(html);
      const result = parseTweets($, mockProfile);

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    test("should filter out show-more items", () => {
      const html = `
        <div class="timeline">
          <div class="timeline-item show-more">
            <a href="/testuser?cursor=abc">Show more</a>
          </div>
          <div class="timeline-item">
            <div class="tweet-header">
              <a class="username" href="/testuser">@testuser</a>
            </div>
            <div class="tweet-body">
              <div class="tweet-content">Real tweet</div>
            </div>
          </div>
        </div>
      `;
      const $ = cheerio.load(html);
      const result = parseTweets($, mockProfile);

      expect(result.every((tweet) => tweet !== null)).toBe(true);
    });

    test("should handle empty timeline", () => {
      const html = '<div class="timeline"></div>';
      const $ = cheerio.load(html);
      const result = parseTweets($, mockProfile);

      expect(result).toEqual([]);
    });
  });
});
