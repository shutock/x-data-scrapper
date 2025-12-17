import { promises as fs } from "fs";
import path from "path";
import ora from "ora";

import { getXData } from "~/src/get-x-data";
import { BrowserPool } from "~/src/lib/browser-pool";

const username = "0xNomis";
const tweetsLimit = 1000;
const delayBetweenPages = 4000;
const maxRetries = 3;

const loader = ora("Initializing browser pool...").start();

// Initialize browser pool
const browserPool = new BrowserPool({
  concurrency: 5,
  timeout: 600000,
});
await browserPool.initialize();

loader.text = "Loading data...";

try {
  const data = await getXData(username, {
    ora: loader,
    tweetsLimit,
    delayBetweenPages,
    maxRetries,
    browserPool,
  });

  loader.text = "Got data";

  const outDir = path.join(process.cwd(), "out");
  await fs.mkdir(outDir, { recursive: true });

  const outFile = path.join(outDir, `${username}.json`);
  await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");

  console.log("\ngot", data.tweets.length, "/", tweetsLimit);

  loader.succeed(`Data saved to ${outFile}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  loader.fail(message);
} finally {
  await browserPool.destroy();
  process.exit(0);
}
