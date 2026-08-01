# Solana Ecosystem Dashboard

A live, auto-updating report on the state of the Solana network: network performance, validator health and decentralization, supply, and economics (price, DeFi TVL, stablecoin supply).

Built for the Superteam Earn bounty ["Develop Solana Ecosystem Auto-Updating Report & Interactive Dashboard"](https://superteam.fun/earn/listing/develop-solana-ecosystem-auto-updating-report-and-interactive-dashboard/).

**No API keys. No paid dependencies. No backend to run or pay for.**

## Three outputs, one codebase

1. **Interactive HTML dashboard** (`public/index.html`) — fetches live data directly in the visitor's browser, client-side, on every load, and again every 60 seconds after that. Open it and the numbers are current at that instant, not a stale cache. Dark theme, as requested in the bounty brief.
2. **Markdown report** (`reports/latest.md`) — human-readable snapshot, regenerated on a schedule.
3. **JSON report** (`reports/latest.json`) — machine-readable snapshot, same data, for anyone who wants to build on top of it. Historical snapshots accumulate in `reports/history/`.

The dashboard and the scheduled report share the same three data sources and the same metrics, just two different delivery mechanisms: one pull-based (visitor's browser fetches on demand), one push-based (a scheduled job commits a fresh snapshot to the repo). That redundancy is deliberate — if GitHub Actions is ever paused, the live dashboard still works on its own with zero maintenance.

## Data sources (all free, all keyless)

| Source | What it provides |
|---|---|
| [Solana public RPC](https://solana-rpc.publicnode.com) | `getEpochInfo`, `getHealth`, `getRecentPerformanceSamples`, `getSupply`, `getVoteAccounts` — network performance, epoch progress, supply, validator set |
| [DeFiLlama](https://defillama.com) | Solana's total value locked (TVL) and its rank among all chains, stablecoin supply on Solana |
| [CoinGecko](https://coingecko.com) | SOL price, market cap, 24h volume/change, and circulating/total supply (doubles as the reliability fallback below) |

All three expose CORS-open public endpoints, verified directly (not assumed) before building this — that's what makes the pure client-side dashboard architecture possible at all.

## Reliability: why this doesn't just break when public infra flakes

Free public RPC endpoints are genuinely unreliable, and this project doesn't pretend otherwise:

- `api.mainnet-beta.solana.com` actively returns `403 Access forbidden` when called from this dashboard's real GitHub Pages origin — confirmed live against the deployed site, not a guess. Default endpoint is `solana-rpc.publicnode.com` instead (also verified live).
- `getSupply` specifically hangs or is explicitly restricted on every free public RPC we tested (publicnode, Ankr, OnFinality, extrnode, Helius' public tier). Rather than chase a fifth endpoint, every single RPC and HTTP call, in both the browser dashboard and the Node report generator, gets its **own timeout** (8s) and is allowed to **fail independently**. One flaky field degrades to "unavailable this refresh" with the exact reason shown, instead of taking the whole dashboard down.
- For circulating/total supply specifically, CoinGecko's market data (already being fetched for price) carries the same numbers RPC would, so it's used as an automatic fallback when `getSupply` doesn't come back in time. In practice this means the Supply section is populated on effectively every load, sourced from whichever of the two actually responded, and labeled accordingly.

This is also why there are two independent delivery mechanisms (live client-side dashboard + scheduled Node report) instead of one: they don't share a failure mode.

## Metrics covered

- **Network:** health check, epoch progress, block height, average and latest-sample TPS
- **Validators:** active vs. delinquent count and %, top 10 by stake, **Nakamoto coefficient** (minimum validators whose combined stake exceeds 1/3 of total active stake — the number that would need to collude or go offline to threaten consensus; computed directly from live stake data, not looked up)
- **Supply:** total and circulating SOL, from RPC or the CoinGecko fallback described above
- **Economics:** SOL price + 24h change, market cap, 24h volume, Solana DeFi TVL and its share of all tracked chains, stablecoin supply on Solana

Not included: Real Economic Value (REV) and precise median transaction fees. Both need either a paid data provider or scanning large volumes of individual transactions, which conflicts with the "no API keys, no external dependencies" goal. Noted here rather than faked with a made-up number.

## Anomaly detection

Deliberately simple and fully transparent, not a black box: `src/anomalyDetection.js` compares the current snapshot to the previously committed one and flags plain, documented threshold breaches — RPC unhealthy, delinquent validators over 5%, delinquency rising more than 2 points since last snapshot, TPS dropping more than 30%, TVL moving more than 10%, SOL price moving more than 8% in 24h. Every threshold is a named constant in that one file. Flags render at the top of both the dashboard and the Markdown report when triggered.

## Automation

`.github/workflows/update-report.yml` runs `node src/generateReport.js` every 6 hours (and on-demand via `workflow_dispatch`), commits `reports/latest.json`, `reports/latest.md`, and a timestamped copy in `reports/history/` back to the repo if anything changed.

`.github/workflows/deploy-pages.yml` publishes `public/` to GitHub Pages whenever it changes.

## Run it yourself

Requires only Node.js 18+, nothing else.

```bash
git clone <this-repo>
cd solana-ecosystem-dashboard
node src/generateReport.js   # writes reports/latest.json and reports/latest.md
```

For the live dashboard, just open `public/index.html` directly in a browser (double-click works, no server needed), or serve the `public/` folder with any static file server.

## One-time setup to enable the scheduled automation on your own fork

GitHub Actions and Pages are both off by default on a new repo — this is a one-time click, not something a workflow file can turn on for you:

1. Push this repo to GitHub.
2. Settings → Actions → General → allow the default `GITHUB_TOKEN` to have **read and write permissions** (needed for the report workflow to commit back).
3. Settings → Pages → Source: **GitHub Actions**.
4. Done — the report updates every 6 hours and the dashboard is live at `https://<user>.github.io/<repo>/`.

## Project structure

```
src/
  fetchers/
    solanaRpc.js     # Solana JSON-RPC calls + derived metrics (TPS, Nakamoto coefficient, ...)
    defiLlama.js      # TVL + stablecoin supply
    coinGecko.js      # SOL price
  anomalyDetection.js # threshold-based flags, compares current vs. previous snapshot
  generateReport.js   # orchestrates the above, writes JSON + Markdown
public/
  index.html          # the live, client-side dashboard (self-contained, no build step)
reports/
  latest.json / latest.md   # most recent snapshot
  history/                  # timestamped snapshots, one per scheduled run
.github/workflows/    # the two automations described above
```
