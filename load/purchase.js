import http, { expectedStatuses } from 'k6/http';
import { check } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Tell k6 that 200 and 409 are both "expected" so neither counts as
// http_req_failed. 409 means sold_out or already_purchased_today — a
// valid business outcome, not a server error.
http.setResponseCallback(expectedStatuses(200, 409));

const TOKENS = JSON.parse(open('./tokens.json'));
const SALE_ITEM_ID = __ENV.SALE_ITEM_ID;
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

if (!SALE_ITEM_ID) throw new Error('SALE_ITEM_ID env var is required — run load/setup.ts first');

export const options = {
  scenarios: {
    purchase: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 1000,
      stages: [
        { target: 500, duration: '20s' },
        { target: 500, duration: '60s' },
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(99)<200'],
  },
};

export default function () {
  const token = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  const res = http.post(
    `${BASE_URL}/v1/flashsale/purchase`,
    JSON.stringify({ sale_item_id: SALE_ITEM_ID }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': uuidv4(),
      },
    },
  );
  // 200 = purchased; 409 = sold_out or already_purchased_today (expected once stock is gone)
  check(res, { 'is 2xx or 409': (r) => r.status === 200 || r.status === 409 });
}
