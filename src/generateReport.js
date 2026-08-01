import { writeFile, readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNetworkSnapshot } from './fetchers/solanaRpc.js';
import { getDefiSnapshot } from './fetchers/defiLlama.js';
import { getPriceSnapshot } from './fetchers/coinGecko.js';
import { detectAnomalies } from './anomalyDetection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const LATEST_JSON = path.join(REPORTS_DIR, 'latest.json');
const LATEST_MD = path.join(REPORTS_DIR, 'latest.md');
const HISTORY_DIR = path.join(REPORTS_DIR, 'history');
const MAX_HISTORY_SNAPSHOTS = 200; // ~7 weeks at every-6-hours; keeps the repo from growing unbounded

async function loadPrevious() {
  try {
    const raw = await readFile(LATEST_JSON, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fmtUsd(n) {
  if (n === null || n === undefined) return 'n/a';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function toMarkdown(report) {
  const { fetchedAt, solana, defi, price, anomalies } = report;
  const lines = [];
  lines.push(`# Solana Ecosystem Report`);
  lines.push('');
  lines.push(`_Generated ${fetchedAt}_`);
  lines.push('');

  if (anomalies.flags.length > 0) {
    lines.push('## ⚠ Flags');
    for (const f of anomalies.flags) {
      const icon = f.severity === 'critical' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
      lines.push(`- ${icon} **${f.metric}:** ${f.message}`);
    }
    lines.push('');
  }

  if (solana.warnings && solana.warnings.length > 0) {
    lines.push('## ⚠ Partial data');
    lines.push('One or more Solana RPC calls failed or timed out this run; those fields show as unavailable below rather than breaking the whole report.');
    solana.warnings.forEach((w) => lines.push(`- ${w}`));
    lines.push('');
  }

  const na = (v) => (v === null || v === undefined ? 'n/a' : v);

  lines.push('## Network');
  lines.push(`- Health: **${na(solana.health)}**`);
  if (solana.epoch) {
    lines.push(`- Epoch ${solana.epoch.epoch}, ${solana.epoch.progressPct.toFixed(2)}% complete (slot ${solana.epoch.slotIndex.toLocaleString('en-US')} / ${solana.epoch.slotsInEpoch.toLocaleString('en-US')})`);
    lines.push(`- Block height: ${solana.epoch.blockHeight.toLocaleString('en-US')} | Absolute slot: ${solana.epoch.absoluteSlot.toLocaleString('en-US')}`);
  } else {
    lines.push('- Epoch info: n/a this run');
  }
  lines.push(`- Avg TPS (last ${solana.performance.sampleWindowCount} samples): **${na(solana.performance.avgTps)}** (${na(solana.performance.avgNonVoteTps)} non-vote)`);
  lines.push(`- Latest sample TPS: ${na(solana.performance.latestSampleTps)}`);
  lines.push('');

  lines.push('## Validators');
  if (solana.validators.current !== null) {
    lines.push(`- Active: ${solana.validators.current.toLocaleString('en-US')} | Delinquent: ${solana.validators.delinquent.toLocaleString('en-US')} (${solana.validators.delinquencyPct}%)`);
    lines.push(`- Nakamoto coefficient (stake): **${solana.validators.nakamotoCoefficient}** validators control >1/3 of active stake`);
    lines.push('');
    lines.push('| # | Vote Account | Commission | Stake (SOL) | Share |');
    lines.push('|---|---|---|---|---|');
    solana.validators.topValidators.forEach((v, i) => {
      lines.push(`| ${i + 1} | \`${v.votePubkey.slice(0, 8)}…\` | ${v.commission}% | ${Math.round(v.activatedStakeSol).toLocaleString('en-US')} | ${v.stakeSharePct.toFixed(2)}% |`);
    });
  } else {
    lines.push('- Validator data: n/a this run');
  }
  lines.push('');

  lines.push('## Supply');
  if (solana.supply) {
    lines.push(`- Total: ${Math.round(solana.supply.totalSol).toLocaleString('en-US')} SOL`);
    lines.push(`- Circulating: ${Math.round(solana.supply.circulatingSol).toLocaleString('en-US')} SOL`);
  } else {
    lines.push('- Supply data: n/a this run (getSupply is unreliable across public RPC endpoints; see README)');
  }
  lines.push('');

  lines.push('## Economics');
  lines.push(`- SOL price: **$${na(price.priceUsd)}** (${price.change24hPct >= 0 ? '+' : ''}${na(price.change24hPct)}% 24h)`);
  lines.push(`- Market cap: ${fmtUsd(price.marketCapUsd)} | 24h volume: ${fmtUsd(price.volume24hUsd)}`);
  lines.push(`- Solana DeFi TVL: ${fmtUsd(defi.tvlUsd)} (rank #${na(defi.tvlRankAmongChains)} across all chains, ${na(defi.tvlShareOfAllChainsPct)}% of tracked TVL)`);
  lines.push(`- Stablecoin supply on Solana: ${fmtUsd(defi.stablecoinSupplyUsd)}`);
  lines.push('');

  lines.push('---');
  lines.push('_Data sources: Solana public RPC (solana-rpc.publicnode.com), DeFiLlama, CoinGecko. No API keys used. See README for methodology, endpoint choice, and how to reproduce this report._');

  return lines.join('\n');
}

export async function generateReport() {
  const previous = await loadPrevious();

  const [solana, defi, price] = await Promise.all([
    getNetworkSnapshot(),
    getDefiSnapshot(),
    getPriceSnapshot(),
  ]);

  const partial = { fetchedAt: new Date().toISOString(), solana, defi, price };
  const anomalies = detectAnomalies(partial, previous);
  const report = { ...partial, anomalies };

  await mkdir(REPORTS_DIR, { recursive: true });
  await mkdir(HISTORY_DIR, { recursive: true });

  await writeFile(LATEST_JSON, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(LATEST_MD, toMarkdown(report), 'utf8');

  const stamp = report.fetchedAt.replace(/[:.]/g, '-');
  await writeFile(path.join(HISTORY_DIR, `${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');
  await pruneHistory();

  return report;
}

async function pruneHistory() {
  const files = (await readdir(HISTORY_DIR)).filter((f) => f.endsWith('.json')).sort();
  const excess = files.length - MAX_HISTORY_SNAPSHOTS;
  if (excess <= 0) return;
  await Promise.all(files.slice(0, excess).map((f) => unlink(path.join(HISTORY_DIR, f))));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  generateReport()
    .then((report) => {
      console.log(`Report generated: ${report.fetchedAt}`);
      console.log(`- Flags: ${report.anomalies.flags.length}`);
      console.log(`- Written to reports/latest.json and reports/latest.md`);
    })
    .catch((err) => {
      console.error('Failed to generate report:', err);
      process.exitCode = 1;
    });
}
