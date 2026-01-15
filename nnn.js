import http from "k6/http";
import { sleep, check } from "k6";

export const options = {
  stages: [
    { duration: "1m", target: 50 },
    { duration: "1m", target: 250 },
    { duration: "1m", target: 350 },
  ],
  thresholds: {
    http_req_duration: ["p(90)<500", "p(95)<800", "p(99)<1200"],
    http_req_failed: ["rate<0.01"],
  },

  summaryTrendStats: [
    "avg",
    "min",
    "max",
    "med",
    "p(50)",
    "p(90)",
    "p(95)",
    "p(99)",
    "count",
  ],
};

export function setup() {
  console.log("Load test is starting...");
}

export default function () {
  const headers = {
    Authorization: `Bearer ${__ENV.TOKEN}`,
    "Content-Type": "application/json",
  };

  const batchResults = http.batch([
    ["GET", `${__ENV.BASE_URL}/api/ingredients/category`, null, { headers, tags: { endpoint: "ingredients-category" } }],
    ["GET", `${__ENV.BASE_URL}/api/ingredients`, null, { headers, tags: { endpoint: "ingredients" } }],
    ["GET", `${__ENV.BASE_URL}/api/ingredients/695aac8c8d36396e73f5c61f`, null, { headers, tags: { endpoint: "ingredient-detail-by-id" } }],
  ]);

  check(batchResults[0], {
    "items status 200": (r) => r.status === 200,
  });

  check(batchResults[1], {
    "orders status 200": (r) => r.status === 200,
  });

  check(batchResults[2], {
    "products status 200": (r) => r.status === 200,
  });

  sleep(0.3);
}

export function teardown() {
  console.log("🏁 Load test finished!");
}
