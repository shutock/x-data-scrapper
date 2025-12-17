/**
 * Test script for production improvements
 */

const baseUrl = "http://localhost:1337";

console.log("🧪 Testing Production Improvements\n");

// Test 1: Multi-instance retry (5 concurrent requests)
console.log("Test 1: Multi-instance retry & concurrent requests");
const usernames = ["0xNomis", "unchase12", "nasa", "eeftp", "artyshatilov"];
const tweetsLimit = 100;

const startTime = Date.now();

const results = await Promise.all(
  usernames.map(async (username) => {
    try {
      const url = new URL(`x-data/${username}`, baseUrl);
      url.searchParams.append("tweetsLimit", tweetsLimit.toString());
      const res = await fetch(url);
      const data = (await res.json()) as any;

      if (data.error) {
        return {
          username,
          status: "error",
          error: data.error,
          metadata: data.metadata,
        };
      }

      return {
        username,
        status: res.status === 206 ? "partial" : "complete",
        collected: data.tweets.length,
        requested: tweetsLimit,
        metadata: data.metadata,
      };
    } catch (error) {
      return {
        username,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),
);

const duration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log(`\n📊 Results (completed in ${duration}s):\n`);

results.forEach((item) => {
  if (item.status === "error") {
    console.log(
      `  ❌ ${item.username}: ERROR - ${item.error} (attempts: ${item.metadata?.attempts || "N/A"})`,
    );
  } else {
    const attempts = item.metadata?.attempts || 1;
    const instance = item.metadata?.instance || "unknown";
    const shortInstance = instance.split("//")[1]?.split("/")[0] || instance;
    const statusEmoji = item.status === "partial" ? "⚠️" : "✅";

    console.log(
      `  ${statusEmoji} ${item.username}: ${item.collected}/${item.requested} (status: ${item.status}, instance: ${shortInstance}, attempts: ${attempts})`,
    );
  }
});

// Calculate success rate
const successful = results.filter((r) => r.status !== "error").length;
const successRate = ((successful / results.length) * 100).toFixed(1);
console.log(
  `\n✅ Success Rate: ${successful}/${results.length} (${successRate}%)`,
);

// Test 2: Invalid username validation
console.log("\n\nTest 2: Username validation");
const invalidUsernames = ["user@domain", "user-with-dash", "a".repeat(20)];

for (const invalidUser of invalidUsernames) {
  const url = new URL(`x-data/${encodeURIComponent(invalidUser)}`, baseUrl);
  const res = await fetch(url);

  if (res.status === 400) {
    console.log(`  ✅ "${invalidUser}" rejected (400)`);
  } else {
    console.log(`  ❌ "${invalidUser}" accepted (should be rejected!)`);
  }
}

// Test 3: Invalid query params
console.log("\n\nTest 3: Query parameter validation");
const invalidParams = [
  { tweetsLimit: 10000, expected: "rejected" },
  { tweetsLimit: 0, expected: "rejected" },
  { delayBetweenPages: 500, expected: "rejected" },
];

for (const params of invalidParams) {
  const url = new URL("x-data/nasa", baseUrl);
  if (params.tweetsLimit !== undefined)
    url.searchParams.append("tweetsLimit", String(params.tweetsLimit));
  if (params.delayBetweenPages !== undefined)
    url.searchParams.append(
      "delayBetweenPages",
      String(params.delayBetweenPages),
    );

  const res = await fetch(url);
  const status = res.status === 400 ? "rejected" : "accepted";

  if (status === params.expected) {
    console.log(`  ✅ ${JSON.stringify(params)} → ${status}`);
  } else {
    console.log(
      `  ❌ ${JSON.stringify(params)} → ${status} (expected ${params.expected})`,
    );
  }
}

// Test 4: Health endpoint
console.log("\n\nTest 4: Health endpoint");
const healthRes = await fetch(`${baseUrl}/health`);
const healthData = (await healthRes.json()) as any;

console.log(`  Status: ${healthData.status}`);
console.log(
  `  Instances: ${healthData.nitterInstances.healthy}/${healthData.nitterInstances.total} healthy`,
);
console.log(
  `  Browser Pool: ${healthData.browserPool.completedTasks} completed, ${healthData.browserPool.failedTasks} failed`,
);

console.log("\n✅ All tests complete!");
