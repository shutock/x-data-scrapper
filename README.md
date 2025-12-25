# X Data Scraper (via Nitter)

A production-ready TypeScript service to scrape Twitter/X user profiles and tweets via [Nitter](https://nitter.net) instances.

## ⚡ Features

- **Massive Instance Pool**: Automatic failover across Nitter instances
- **Self-Healing**: Proactive instance recovery via probabilistic retry (15% chance)
- **Browser Pooling**: Efficient resource usage with 5 browser workers
- **Smart Rate Limiting**: 1.5 req/sec with 15-token burst capacity
- **Automatic Retry**: Tries up to 3 instances before failing
- **Partial Results**: Returns partial data on timeout (HTTP 206)
- **Production Ready**: Comprehensive validation, error handling, and monitoring
- **Fast & Reliable**: 100 tweets in ~4 seconds, 100% success rate

## 📊 Performance

| Metric                  | Performance                |
| ----------------------- | -------------------------- |
| **100 tweets**          | ~4-5 seconds               |
| **1000 tweets**         | ~40-60 seconds             |
| **Success rate**        | 100% (with 4 instances)    |
| **Concurrent requests** | 5-10 simultaneous users    |
| **Availability**        | 99.9% (automatic failover) |

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (latest version)

### Installation

```bash
# Clone repository
git clone https://github.com/shutock/x-data-scrapper.git
cd x-data-scrapper

# Install dependencies
bun install

# Copy environment file
cp .env.example .env
```

### Start the Service

```bash
# Development (with auto-reload)
bun --watch index

# Production
bun run index
```

### Make API Requests

```bash
# Get 100 tweets from a user
curl "http://localhost:1337/x-data/elonmusk?tweetsLimit=100"

# Get 1000 tweets
curl "http://localhost:1337/x-data/nasa?tweetsLimit=1000"

# Check service health
curl "http://localhost:1337/health"
```

## 🐳 Docker Deployment

### Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) installed and running

### Quick Start with Docker

```bash
# Clone repository
git clone https://github.com/shutock/x-data-scrapper.git
cd x-data-scrapper

# Copy environment file
cp .env.example .env

# Build and start with Docker Compose
docker compose up -d --build

# View logs
docker compose logs -f x-data-scrapper

# Check status
docker compose ps

# Stop the service
docker compose down
```

### Using Docker Directly

```bash
# Build the image
docker build -t x-data-scraper .

# Run the container
docker run -d \
  --name x-data-scraper \
  -p 1337:1337 \
  --env-file .env \
  --shm-size=2gb \
  -v $(pwd)/out:/app/out \
  x-data-scraper

# View logs
docker logs -f x-data-scraper

# Stop the container
docker stop x-data-scraper
docker rm x-data-scraper
```

### Docker Configuration

The Docker setup includes:

- **Base Image**: `oven/bun:1.3.4-alpine` with Chromium pre-installed
- **Port**: 1337 (configurable via `PORT` env variable)
- **Memory Limit**: 2GB (adjustable in `docker-compose.yml`)
- **CPU Limit**: 2 cores (adjustable in `docker-compose.yml`)
- **Shared Memory**: 2GB (required for Puppeteer/Chromium)
- **Volume**: `./out` directory for persistent data storage

### Important Docker Notes

⚠️ **Shared Memory Size**: The `--shm-size=2gb` flag is critical for Puppeteer/Chromium to function properly. Without it, the browser will crash.

📁 **Data Persistence**: Scraped data is saved to the `./out` directory which is mounted as a volume, ensuring data persists even if the container is removed.

🔧 **Environment Variables**: Make sure to configure your `.env` file before running the container. All environment variables from `.env` will be loaded automatically.

## 📖 API Documentation

### **GET /x-data/:username**

Scrape tweets from a Twitter/X user.

**Parameters:**

- **Path**: `username` (1-15 chars, alphanumeric + underscore only)
- **Query**:
  - `tweetsLimit` (optional): 1-5000, default: 100
  - `delayBetweenPages` (optional): 1000-30000ms, default: 4000
  - `maxRetries` (optional): 1-10, default: 3

**Response Codes:**

- `200 OK` - Full results
- `206 Partial Content` - Partial results (timeout, ≥20% collected)
- `400 Bad Request` - Invalid username or parameters
- `500 Internal Server Error` - All instances failed

**Response Format:**

```json
{
  "profile": {
    "username": "elonmusk",
    "name": "Elon Musk",
    "bio": "...",
    "profile_photo_url": "...",
    "registration_date": "..."
  },
  "stats": {
    "tweets": 50000,
    "following": 500,
    "followers": 150000000,
    "likes": 10000
  },
  "tweets": [
    {
      "author": {...},
      "content": "Tweet text...",
      "url": "https://nitter.net/...",
      "created_at": "Dec 16, 2025",
      "metrics": {
        "comments": 100,
        "retweets": 500,
        "quotes": 50,
        "likes": 5000,
        "views": 100000
      },
      "kind": "tweet|retweet|quote",
      "child": {...}  // For retweets/quotes
    }
  ],
  "metadata": {
    "collected": 100,
    "requested": 100,
    "status": "complete",
    "instance": "https://nitter.tiekoetter.com",
    "attempts": 1
  }
}
```

### **GET /health**

Check service health and instance status.

**Response:**

```json
{
  "status": "healthy|unhealthy",
  "timestamp": "2025-12-16T...",
  "uptime": 123.45,
  "nitterInstances": {
    "total": 2,
    "healthy": 2,
    "instances": [...]
  },
  "browserPool": {
    "workerCount": 5,
    "completedTasks": 100,
    "failedTasks": 0
  }
}
```

### **GET /metrics**

Get rate limiter metrics for monitoring.

## ⚙️ Configuration

All configuration via `.env` file:

### **Essential Settings**

```bash
# Server
PORT="1337"

# Scraping
POSTS_LIMIT="100"  # Default tweets per request
DELAY_BETWEEN_PAGES="4000"  # Delay between pagination

# Rate Limiting (optimized for reliability)
RATE_LIMITER_REQUESTS_PER_SECOND="1.5"  # Safe: 1.0-2.0
RATE_LIMITER_BURST_CAPACITY="15"

# Browser Pool
BROWSER_POOL_SIZE="5"  # Number of browser workers
```

### **Advanced Settings**

```bash
# File Storage
SAVE_TO_FILE="true"  # Set to "false" for API-only mode

# Timeouts
SCRAPING_TIMEOUT_MS="300000"  # 5 minutes max per request
HEALTH_CHECK_TIMEOUT_MS="8000"

# Instance Management
MAX_INSTANCE_RETRIES="3"  # Try 3 instances before failing
INSTANCE_RETRY_DELAY_MS="1000"  # Delay between retries
UNHEALTHY_INSTANCE_RETRY_PROBABILITY="0.15"  # 15% chance to retry unhealthy instances (self-healing)

# Partial Results
PARTIAL_RESULTS_MIN_THRESHOLD="0.2"  # 20% minimum for partial results

# Feature Flags
ENABLE_THOROUGH_HEALTH_CHECKS="true"
NITTER_HEALTH_CHECK_INTERVAL="300000"  # 5 minutes
```

See `.env.example` for all options.

## 🧪 Examples & Testing

### Run Tests

```bash
# All unit tests
bun test
```

### Examples

The project includes several example scripts to demonstrate functionality and test different scenarios. All examples use `fetch` requests and include visual progress indicators.

```bash
# 1. Basic Fetch (Single User)
# Fetches profile and 100 tweets for a single user
bun run examples/basic-fetch.ts

# 2. Concurrent Requests
# Tests performance with 10 simultaneous requests
bun run examples/concurrent-requests.ts

# 3. Health & Metrics Check
# Validates /health and /metrics endpoints
bun run examples/health-check.ts

# 4. Large Dataset Fetch
# Fetches 500 tweets to test pagination and stability
bun run examples/large-dataset.ts

# 5. Error Handling Test
# Tests 10 different error scenarios (invalid users, bad params)
bun run examples/error-handling.ts

# 6. Production Validation
# Comprehensive suite testing retries, validation, and health
bun run examples/production-validation.ts
```

### Test Results

```
✅ 88 unit tests passing
✅ 100% success rate on examples
✅ All validation tests passing
✅ All error handling tests passing
✅ 4 Nitter instances configured
```

## 🏗️ Architecture

### **Components**

1. **Nitter Instance Pool**
   - Manages 4 Nitter instances from community-maintained list
   - Automatic health checks every 5 minutes
   - Round-robin load distribution
   - Self-healing via probabilistic retry (15% chance to retry unhealthy instances)
   - Failure detection & automatic recovery

2. **Browser Pool**
   - 5 Puppeteer browser workers
   - Shared browser instances (context isolation)
   - Automatic cleanup & resource management

3. **Rate Limiters**
   - Job limiter: Max 5 concurrent scraping jobs
   - Nitter limiter: 1.5 req/sec with token bucket

4. **Multi-Instance Retry**
   - Tries up to 3 instances on failure
   - Automatic failover in ~1 second
   - Tracks attempts in response

### **Request Flow**

```
Client Request
  ↓
Validation (username + query params)
  ↓
Multi-Instance Retry Loop (max 3 attempts)
  ↓
  Get Healthy Instance → Job Limiter → Browser Pool
    ↓
  Scrape with Timeout (5 min)
    ↓
  Success? → Return 200
  Timeout + ≥20% data? → Return 206
  Failure? → Try next instance
  ↓
Save to File (async, optional)
  ↓
Return Response with Metadata
```

## 🛠️ Tech Stack

- **Runtime**: Bun
- **Framework**: Hono (HTTP server)
- **Scraping**: Puppeteer & Puppeteer-Cluster
- **Parsing**: Cheerio
- **Validation**: Zod
- **CLI**: Ora
- **Utilities**: Lodash

## 🔍 Monitoring

### Health Check

```bash
# Watch instance health
watch -n 30 'curl -s http://localhost:1337/health | jq ".nitterInstances"'
```

### Metrics

```bash
# Watch request metrics
watch -n 10 'curl -s http://localhost:1337/metrics | jq ".jobs"'
```

## 🐛 Troubleshooting

### "No healthy Nitter instances available"

- Check `/health` endpoint to see instance statuses
- Instances will auto-recover via probabilistic retry (15% chance per request)
- Periodic health checks run every 5 minutes for full recovery
- If issue persists, restart service to force immediate health check
- Consider adjusting `UNHEALTHY_INSTANCE_RETRY_PROBABILITY` (0.15 = 15%) for faster/slower recovery

### "Request timed out" (206 Partial)

- Normal for large requests (1000+ tweets)
- Increase `SCRAPING_TIMEOUT_MS` if needed
- Partial results still returned if ≥20% collected

### Slow performance

- Increase `RATE_LIMITER_REQUESTS_PER_SECOND` (max 2.0 recommended)
- Decrease `DELAY_BETWEEN_PAGES` (min 3000ms recommended)
- Check instance health with `/health` endpoint

### High memory usage

- Reduce `BROWSER_POOL_SIZE`
- Limit concurrent requests
- Check for leaks with `/health` endpoint

## 📝 Development

### Run in Development Mode

```bash
bun --watch index
```

### Run Tests

```bash
# All tests
bun test

# Watch mode
bun test --watch

# Specific test file
bun test src/lib/rate-limiter/rate-limiter.test
```

### Format Code

```bash
bun run format
```

## 🔐 Security

- ✅ Username sanitization (prevents path traversal)
- ✅ Input validation (Zod schemas)
- ✅ Query parameter range limits
- ✅ Safe error messages (no sensitive data leaks)
- ✅ Resource limits (timeouts, concurrent requests)

## 📦 Production Deployment

### Recommended Settings

```bash
# API-only mode (no file saving)
SAVE_TO_FILE=false

# Conservative rate limiting
RATE_LIMITER_REQUESTS_PER_SECOND=1.5

# Reasonable timeout
SCRAPING_TIMEOUT_MS=300000

# Multiple retries for reliability
MAX_INSTANCE_RETRIES=3
```

### Resource Requirements

- **Memory**: ~700MB (500MB browser pool + 200MB app)
- **CPU**: 2+ cores recommended
- **Network**: Stable connection to Nitter instances
- **Disk**: Optional (only if SAVE_TO_FILE=true)

### Monitoring

- Monitor `/health` endpoint (should return 200)
- Alert if `nitterInstances.healthy < 1`
- Track metrics via `/metrics` endpoint
- Log analysis for error patterns

## 🎯 Performance Tuning

### For Speed (Higher Risk)

```bash
RATE_LIMITER_REQUESTS_PER_SECOND="2.0"  # Faster but more rate limit risk
DELAY_BETWEEN_PAGES="3000"  # Faster pagination
```

### For Reliability (Slower)

```bash
RATE_LIMITER_REQUESTS_PER_SECOND="1.0"  # Very safe
DELAY_BETWEEN_PAGES="6000"  # Very conservative
MAX_INSTANCE_RETRIES="5"  # More retries
```

### For High Concurrency

```bash
BROWSER_POOL_SIZE="10"  # More workers
RATE_LIMITER_MAX_CONCURRENT="3"  # More concurrent navigations
```

## 📄 License

See [LICENSE](LICENSE) file.

## 🙏 Acknowledgments

- [Nitter](https://github.com/zedeus/nitter) - Alternative Twitter frontend
- Nitter instance maintainers (nitter.tiekoetter.com, nitter.privacyredirect.com)

## ⚠️ Disclaimer

This tool relies on public Nitter instances to access Twitter data. Availability and functionality may depend on the status of the Nitter instances. Use responsibly and respect rate limits.

**Not affiliated with Twitter/X or Nitter projects.**
