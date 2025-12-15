import { Hono } from "hono";
import { getData } from "./src";

const app = new Hono();

app.get("/", async (c) => {
  const username = c.req.query("username");
  if (!username) {
    return c.text(
      "Twitter Data Scraper API. Use /:username or /?username=handle to get data."
    );
  }

  try {
    const data = await getData(username);
    return c.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

app.get("/:username", async (c) => {
  const username = c.req.param("username");
  try {
    const data = await getData(username);
    return c.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

export default {
  port: Number(process.env.PORT || 3000),
  fetch: app.fetch,
};
