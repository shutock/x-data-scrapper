import { promises as fs } from "fs";
import path from "path";
import ora from "ora";

import { getData } from "./src";

const username = "unchase12";
const postsLimit = 500;
const delayBetweenPages = 4000;
const maxRetries = 3;

const loader = ora("Loading data...").start();

try {
  const data = await getData(username, {
    ora: loader,
    postsLimit,
    delayBetweenPages,
    maxRetries,
  });

  loader.text = "Got data";

  const outDir = path.join(process.cwd(), "out");
  await fs.mkdir(outDir, { recursive: true });

  const outFile = path.join(outDir, `${username}.json`);
  await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");

  console.log("\ngot", data.tweets.length, "/", postsLimit);

  loader.succeed(`Data saved to ${outFile}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  loader.fail(message);
}
