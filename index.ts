import Bun from "bun";
import { getData } from "./src";

Bun.serve({
  port: 3000,
  fetch: async (req) => {
    const url = new URL(req.url);

    try {
      const username = url.searchParams.get("username");
      if (!username)
        return new Response("Username is required", { status: 400 });

      const data = await getData(username);
      return Response.json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return new Response(message, { status: 500 });
    }
  },
});
