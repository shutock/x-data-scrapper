import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Hono } from "hono";

import { getData } from "./get-data";

export const app = new Hono();

app.get("/:username", async (c) => {
  const username = c.req.param("username");
  const postsLimit = Number(
    c.req.query("postsLimit") || process.env.POSTS_LIMIT || 100,
  );

  try {
    const data = await getData(username, { postsLimit });
    // save to `out/${username}.json`
    const outDir = path.join(process.cwd(), "out");
    await fs.mkdir(outDir, { recursive: true });

    const outFile = path.join(outDir, `${username}.json`);
    await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");

    return c.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});
