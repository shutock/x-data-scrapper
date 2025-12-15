import ora from "ora";
import { promises as fs } from "fs";
import path from "path";

import { getData } from "./src";

const username = "eeftp";

const loader = ora("Loading data...").start();

try {
  const data = await getData(username, loader);

  loader.text = "Got data";

  const outDir = path.join(process.cwd(), "out");
  await fs.mkdir(outDir, { recursive: true });

  const outFile = path.join(outDir, `${username}.json`);
  await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");

  loader.succeed(`Data saved to ${outFile}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  loader.fail(message);
}
