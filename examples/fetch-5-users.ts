import type { getXData } from "~/src/get-x-data";

type Result = Awaited<ReturnType<typeof getXData>>;

const baseUrl = "http://localhost:1337";

const usernames = ["elonmusk", "BillGates", "BarackObama", "NASA", "SpaceX"];
const tweetsLimit = 1000;

const results = await Promise.all(
  usernames.map(async (username) => {
    try {
      const url = new URL(`x-data/${username}`, baseUrl);
      url.searchParams.append("tweetsLimit", tweetsLimit.toString());
      const res = await fetch(url);
      const data = (await res.json()) as any;

      // Check if it's an error response
      if (data.error) {
        return { username, data: null, error: data.error };
      }

      return { username, data: data as Result, error: null };
    } catch (error) {
      return {
        username,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),
);

results.forEach((item) => {
  if (item.error) {
    console.log(`${item.username}: ERROR - ${item.error}`);
  } else if (item.data) {
    const metadata = (item.data as any).metadata;
    if (metadata) {
      console.log(
        `${item.username}: ${item.data.tweets.length}/${tweetsLimit} (status: ${metadata.status}, instance: ${metadata.instance})`,
      );
    } else {
      console.log(
        `${item.username}: ${item.data.tweets.length}/${tweetsLimit}`,
      );
    }
  } else {
    console.log(`${item.username}: ERROR - Unknown error`);
  }
});
