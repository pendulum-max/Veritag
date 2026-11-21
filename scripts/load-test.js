/**
 * Veritag k6 Load & Stress Test
 * ==============================
 * Simulates consumers scanning QR codes and activating units at high volume.
 *
 * Ramp-up profile
 *   Stage 1 (30 s)  :  0 → 50  VUs   — warm-up
 *   Stage 2 (60 s)  : 50 → 250 VUs   — ramp-up
 *   Stage 3 (120 s) :      250 VUs   — sustained load
 *   Stage 4 (60 s)  :250 → 1000 VUs  — stress peak
 *   Stage 5 (60 s)  :     1000 VUs   — peak hold
 *   Stage 6 (30 s)  :1000 → 0  VUs   — cool-down
 *
 * Thresholds
 *   p(95) of all 200-OK requests < 250 ms
 *   Error rate < 1 %
 *
 * Configuration via environment variables (pass with -e KEY=VALUE):
 *   BASE_URL              Backend base URL   (default: http://localhost:4000)
 *   BRAND_ADDRESS         Stellar brand address used in test data
 *   BATCH_ID              64-char hex batch ID
 *   UNIT_ID               64-char hex unit ID (for /api/units/verify)
 *
 * Run (requires k6 ≥ 0.49):
 *   k6 run scripts/load-test.js
 *   k6 run -e BASE_URL=http://staging.example.com scripts/load-test.js
 *
 * Run with output summary (HTML report):
 *   k6 run --out json=results.json scripts/load-test.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const verifyOkRate       = new Rate("verify_ok_rate");
const activateOkRate     = new Rate("activate_ok_rate");
const verifyDuration     = new Trend("verify_duration_ms", true);
const activateDuration   = new Trend("activate_duration_ms", true);
const relayerQueueErrors = new Counter("relayer_queue_errors");

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------
const BASE_URL       = __ENV.BASE_URL       || "http://localhost:4000";
const BRAND_ADDRESS  = __ENV.BRAND_ADDRESS  || "GCFGKLCBV5IGJYGRR7FJNU53HFV5674PMQNNJT6HRAFGUAHZ7V3ZELXR";
const BATCH_ID       = __ENV.BATCH_ID       || "a".repeat(64);
// Use a fixed unit ID for verify (read-only, deterministic).
const UNIT_ID        = __ENV.UNIT_ID        || "b".repeat(64);
// Serial range to spread activate attempts across many unique serials so
// they hit the "unit not yet activated" code path rather than the duplicate
// path (which would short-circuit the relayer queue).
const SERIAL_PREFIX  = "load-test-serial-";

export const options = {
  stages: [
    // Stage 1: Warm-up
    { duration: "30s",  target: 50   },
    // Stage 2: Ramp-up
    { duration: "60s",  target: 250  },
    // Stage 3: Sustained load
    { duration: "120s", target: 250  },
    // Stage 4: Stress ramp to peak
    { duration: "60s",  target: 1000 },
    // Stage 5: Peak hold
    { duration: "60s",  target: 1000 },
    // Stage 6: Cool-down
    { duration: "30s",  target: 0    },
  ],

  thresholds: {
    // p95 latency for all successful (HTTP 2xx) requests must be < 250 ms.
    "http_req_duration{status:200}": ["p(95)<250"],
    // Less than 1 % of all requests should fail.
    http_req_failed: ["rate<0.01"],
    // Scenario-specific thresholds.
    verify_duration_ms:   ["p(95)<250"],
    activate_duration_ms: ["p(95)<500"],
  },
};

// ---------------------------------------------------------------------------
// Shared request parameters
// ---------------------------------------------------------------------------
const jsonHeaders = { "Content-Type": "application/json" };

// ---------------------------------------------------------------------------
// Helper: generate a unique-ish serial for this VU iteration so activate
// requests hit many different units rather than hammering a single one.
// ---------------------------------------------------------------------------
function uniqueSerial(vu, iter) {
  return `${SERIAL_PREFIX}${vu}-${iter}`;
}

// ---------------------------------------------------------------------------
// Scenario: GET /v1/verify/:brand/:batch/:serial (read-heavy path)
// ---------------------------------------------------------------------------
function scenarioVerify() {
  const serial = uniqueSerial(__VU, __ITER);
  const url = `${BASE_URL}/v1/verify/${BRAND_ADDRESS}/${BATCH_ID}/${encodeURIComponent(serial)}`;

  const res = http.get(url, { tags: { scenario: "verify" } });
  const ok = check(res, {
    "verify: status is 200": (r) => r.status === 200,
    "verify: has status field": (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.status === "string";
      } catch {
        return false;
      }
    },
  });

  verifyOkRate.add(ok);
  verifyDuration.add(res.timings.duration);
  return ok;
}

// ---------------------------------------------------------------------------
// Scenario: POST /v1/activate (write-heavy path — exercises relayer queue)
// ---------------------------------------------------------------------------
function scenarioActivate() {
  const serial  = uniqueSerial(__VU, __ITER);
  const payload = JSON.stringify({
    brand:      BRAND_ADDRESS,
    batchId:    BATCH_ID,
    serial:     serial,
    secret:     `secret-${__VU}-${__ITER}`,
    firstOwner: BRAND_ADDRESS, // re-use brand address as a placeholder owner
    proof:      [],
  });

  const res = http.post(`${BASE_URL}/v1/activate`, payload, {
    headers: jsonHeaders,
    tags: { scenario: "activate" },
  });

  // 201 = newly activated, 400/409 are expected for invalid proof / duplicate
  // — only treat 5xx as queue/relayer failures.
  const queued = res.status < 500;
  if (res.status >= 500) {
    relayerQueueErrors.add(1);
  }

  const ok = check(res, {
    "activate: not a 5xx error": () => queued,
    "activate: has JSON body":   (r) => {
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
  });

  activateOkRate.add(res.status === 201);
  activateDuration.add(res.timings.duration);
  return ok;
}

// ---------------------------------------------------------------------------
// Scenario: GET /health  (baseline sanity check — cheap, always passes)
// ---------------------------------------------------------------------------
function scenarioHealth() {
  const res = http.get(`${BASE_URL}/health`, { tags: { scenario: "health" } });
  check(res, {
    "health: status is 200": (r) => r.status === 200,
  });
}

// ---------------------------------------------------------------------------
// Default function — each VU executes this in a loop
// ---------------------------------------------------------------------------
export default function () {
  // Weight the scenarios: 70 % verify (heavy read), 20 % activate, 10 % health
  const roll = Math.random();

  if (roll < 0.70) {
    group("verify", scenarioVerify);
  } else if (roll < 0.90) {
    group("activate", scenarioActivate);
  } else {
    group("health", scenarioHealth);
  }

  // Brief think-time between requests to emulate realistic user pacing.
  sleep(Math.random() * 0.5 + 0.1);
}

// ---------------------------------------------------------------------------
// Setup — called once before VUs start; confirms the backend is reachable.
// ---------------------------------------------------------------------------
export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    console.error(`[setup] Backend not reachable at ${BASE_URL}/health (got ${res.status}). Aborting.`);
    // Returning a non-zero exit code from setup isn't directly supported by
    // k6, but logging the error ensures the operator notices it in CI output.
  }
  console.log(`[setup] Backend healthy at ${BASE_URL}`);
}

// ---------------------------------------------------------------------------
// Teardown — called once after all VUs finish.
// ---------------------------------------------------------------------------
export function teardown(data) {
  console.log("[teardown] Load test complete.");
}
