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

1. Open `index.ts` and modify the `username` variable to the Twitter handle you want to scrape:

   ```typescript
   const username = "eeftp"; // Change this to the desired username
   ```

2. Run the scraper:

   ```bash
   bun run start
   ```

   Or for development with watch mode:

   ```bash
   bun run dev
   ```

3. The data will be saved to `out/<username>.json`.

## Tech Stack

- **Runtime**: Bun
- **Scraping**: Puppeteer & Cheerio
- **Validation**: Zod
- **CLI**: Ora

## Disclaimer

This tool relies on Nitter instances to access Twitter data. Availability and functionality may depend on the status of the Nitter instance being used.
