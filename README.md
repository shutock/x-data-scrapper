# shutock/twitter-data

A TypeScript tool to scrape Twitter user profiles and tweets via [Nitter](https://nitter.net).

## Features

- **Profile Data**: Scrapes username, display name, bio, profile picture, cover photo, registration date, and verification status.
- **Statistics**: Fetches counts for tweets, following, followers, and likes.
- **Tweets**: Retrieves recent tweets with content, metrics (likes, retweets, etc.), and timestamps.
- **Output**: Saves the scraped data as a JSON file.

## Prerequisites

- [Bun](https://bun.sh/) (latest version)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/shutock/twitter-data.git
   cd twitter-data
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

## Usage

1. Open `demo.ts` and modify the configuration:

   ```typescript
   const username = "unchase12"; // Change this to the desired username
   const postsLimit = 500; // Maximum number of tweets to scrape
   const delayBetweenPages = 3000; // Delay in ms between page navigations (rate limiting)
   const maxRetries = 3; // Number of retries on navigation failure
   ```

2. Run the scraper:

   ```bash
   bun run demo.ts
   ```

3. The data will be saved to `out/<username>.json`.

### Configuration Options

- **`postsLimit`**: Maximum number of tweets to retrieve (default: 100)
- **`delayBetweenPages`**: Base delay in milliseconds between page navigations (default: 4000ms)
  - Uses randomized delays (±20-50% variation) to mimic human behavior
  - Recommended: 4000-6000ms for consistent results
- **`maxRetries`**: Number of retry attempts when navigation fails (default: 3)
  - Uses exponential backoff with randomization on retries

**Rate Limiting Strategy**: The scraper uses lodash to implement adaptive delays with randomization, making requests appear more human-like and avoiding Nitter's rate limits more effectively.

## Tech Stack

- **Runtime**: Bun
- **Scraping**: Puppeteer & Cheerio
- **Validation**: Zod
- **CLI**: Ora

## Disclaimer

This tool relies on Nitter instances to access Twitter data. Availability and functionality may depend on the status of the Nitter instance being used.
