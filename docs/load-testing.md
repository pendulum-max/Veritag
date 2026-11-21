# Load & Stress Testing with k6

This document describes how to run the Veritag k6 load test against the backend API, interpret results, and tune a mock server for CI or offline use.

---

## Overview

The test script at `scripts/load-test.js` simulates the traffic pattern of a major consumer product launch — thousands of customers scanning QR codes simultaneously:

| Scenario | Endpoint | Weight | Purpose |
|---|---|---|---|
| **verify** | `GET /v1/verify/:brand/:batch/:serial` | 70 % | Simulates public QR scan reads. |
| **activate** | `POST /v1/activate` | 20 % | Exercises the Merkle-proof validation and relayer queue. |
| **health** | `GET /health` | 10 % | Baseline sanity check. |

### Ramp-up stages

| Stage | Duration | Target VUs | Description |
|---|---|---|---|
| 1 | 30 s | 50 | Warm-up |
| 2 | 60 s | 250 | Ramp-up |
| 3 | 120 s | 250 | Sustained load |
| 4 | 60 s | 1 000 | Stress peak ramp |
| 5 | 60 s | 1 000 | Peak hold |
| 6 | 30 s | 0 | Cool-down |

Total test duration: **6 minutes**.

### Thresholds (pass/fail criteria)

| Metric | Threshold |
|---|---|
| `http_req_duration{status:200}` p(95) | < 250 ms |
| `http_req_failed` rate | < 1 % |
| `verify_duration_ms` p(95) | < 250 ms |
| `activate_duration_ms` p(95) | < 500 ms |

---

## Prerequisites

Install k6 (version ≥ 0.49):

```bash
# macOS (Homebrew)
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows (Chocolatey)
choco install k6

# Docker
docker pull grafana/k6
```

---

## Running the tests

### Against your local backend

Start the backend first:

```bash
docker compose up -d postgres minio
pnpm --filter backend db:migrate
pnpm --filter backend dev
```

Then in a second terminal:

```bash
pnpm test:load
# or directly:
k6 run scripts/load-test.js
```

### Against a custom environment

```bash
k6 run \
  -e BASE_URL=http://staging.example.com \
  -e BRAND_ADDRESS=GCFGKLCBV5... \
  -e BATCH_ID=aabbcc...64chars \
  scripts/load-test.js
```

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | `http://localhost:4000` | Backend base URL |
| `BRAND_ADDRESS` | demo address | Stellar G… address of the test brand |
| `BATCH_ID` | `"a" × 64` | 64-char hex batch ID to include in verify/activate requests |
| `UNIT_ID` | `"b" × 64` | Reserved for future targeted unit reads |

### Save results as JSON

```bash
k6 run --out json=results.json scripts/load-test.js
```

Then use the [k6 HTML reporter](https://github.com/benc-uk/k6-reporter) or Grafana + InfluxDB for dashboards.

---

## Mock server for CI / offline testing

You can run the load test in CI without a real backend by pointing it at a lightweight mock. The simplest option is [json-server](https://github.com/typicode/json-server) or a small Express stub:

### Express mock (Node.js)

Create `scripts/mock-server.js`:

```js
import express from "express";
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/v1/verify/:brand/:batch/:serial", (_req, res) =>
  res.json({ status: "AuthenticInactive", authentic: true, scanCount: 1 })
);

app.post("/v1/activate", (_req, res) =>
  res.status(201).json({ unitId: "mock", activatedAt: Date.now() })
);

app.listen(4000, () => console.log("Mock backend on :4000"));
```

Run it before k6:

```bash
node scripts/mock-server.js &
k6 run scripts/load-test.js
```

The thresholds are designed so that the mock (which responds in < 1 ms) always passes, confirming the script wiring is correct before running against a real environment.

---

## Interpreting results

After the run, k6 prints a summary table. Key metrics to watch:

- **`http_req_duration` p(95)** — tail latency for all requests.
- **`http_req_failed`** — requests that errored or returned a 4xx/5xx.
- **`verify_duration_ms` p(95)** — tail latency for the verify path specifically.
- **`activate_duration_ms` p(95)** — tail latency for the activate path.
- **`relayer_queue_errors`** — count of 5xx responses from the relayer path; non-zero indicates queue saturation or Soroban RPC back-pressure.

A `✓` next to each threshold name means the test passed. A `✗` means it failed.

### Diagnosing database saturation

If `verify_duration_ms` p(95) spikes above 250 ms under load:

1. Check Postgres `pg_stat_activity` for long-running queries.
2. Ensure `units.unit_id`, `scans.unit_id`, and `batches.(brand, batch_id)` are indexed.
3. Increase the connection pool size in the backend config.

### Diagnosing relayer queue back-pressure

If `relayer_queue_errors` is non-zero:

1. Check the backend logs for `RelayerQueueFull` or Soroban RPC timeouts.
2. The relayer uses a sliding-window rate limiter per caller; under test load many VUs share the same IP, so the per-IP cap may be hit — increase `RATE_LIMIT_PER_MIN` for load tests.
3. Consider running multiple backend replicas behind a load balancer for production.

---

## CI integration (GitHub Actions)

```yaml
# .github/workflows/load-test.yml
name: Load Test

on:
  workflow_dispatch:
  schedule:
    - cron: "0 2 * * 1"   # Every Monday at 02:00 UTC

jobs:
  k6:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install k6
        run: |
          sudo gpg --no-default-keyring \
            --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
            --keyserver hkp://keyserver.ubuntu.com:80 \
            --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
            | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update && sudo apt-get install -y k6

      - name: Start mock backend
        run: node scripts/mock-server.js &

      - name: Run k6
        run: k6 run scripts/load-test.js
```

For a full integration test, replace the mock with the real stack using Docker Compose services and the `docker-compose.local.yml` file.
