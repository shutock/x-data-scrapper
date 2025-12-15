import { app } from "~/src";
import { PORT } from "~/src/lib/constants";

export default {
  port: Number(PORT),
  fetch: app.fetch,
};
