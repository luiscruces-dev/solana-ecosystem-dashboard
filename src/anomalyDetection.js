// Lightweight, honest anomaly detection: compares the current snapshot against
// the previously committed one and flags large moves. No ML, no black box —
// every threshold below is a plain, documented rule so a reader can verify it.

const THRESHOLDS = {
  tpsDropPct: 30, // flag if avg TPS falls more than this % vs previous snapshot
  delinquencyPctAbsolute: 5, // flag if delinquent validators exceed this % of total
  delinquencyJumpPct: 2, // flag if delinquency % rises by more than this many points
  tvlMovePct: 10, // flag if TVL moves more than this % since previous snapshot
  solPriceMovePct: 8, // flag if 24h SOL price change exceeds this %
  slotTimeSecTarget: 0.4, // Solana's target slot time; used for a soft slot-time estimate
};

export function detectAnomalies(current, previous) {
  const flags = [];

  if (current.solana.health !== 'ok') {
    flags.push({
      severity: 'critical',
      metric: 'health',
      message: `getHealth did not return "ok": ${current.solana.health}`,
    });
  }

  if (current.solana.validators.delinquencyPct >= THRESHOLDS.delinquencyPctAbsolute) {
    flags.push({
      severity: 'warning',
      metric: 'validator_delinquency',
      message: `${current.solana.validators.delinquencyPct}% of validators are delinquent (threshold: ${THRESHOLDS.delinquencyPctAbsolute}%)`,
    });
  }

  if (previous) {
    const prevTps = previous.solana.performance.avgTps;
    const curTps = current.solana.performance.avgTps;
    if (prevTps && curTps) {
      const dropPct = ((prevTps - curTps) / prevTps) * 100;
      if (dropPct >= THRESHOLDS.tpsDropPct) {
        flags.push({
          severity: 'warning',
          metric: 'tps_drop',
          message: `Average TPS dropped ${dropPct.toFixed(1)}% vs previous snapshot (${prevTps} -> ${curTps})`,
        });
      }
    }

    const prevDelinq = previous.solana.validators.delinquencyPct;
    const curDelinq = current.solana.validators.delinquencyPct;
    if (typeof prevDelinq === 'number' && curDelinq - prevDelinq >= THRESHOLDS.delinquencyJumpPct) {
      flags.push({
        severity: 'warning',
        metric: 'delinquency_jump',
        message: `Delinquent validator share rose from ${prevDelinq}% to ${curDelinq}% since last snapshot`,
      });
    }

    const prevTvl = previous.defi.tvlUsd;
    const curTvl = current.defi.tvlUsd;
    if (prevTvl && curTvl) {
      const movePct = ((curTvl - prevTvl) / prevTvl) * 100;
      if (Math.abs(movePct) >= THRESHOLDS.tvlMovePct) {
        flags.push({
          severity: 'info',
          metric: 'tvl_move',
          message: `Solana TVL moved ${movePct.toFixed(1)}% since last snapshot ($${(prevTvl / 1e9).toFixed(2)}B -> $${(curTvl / 1e9).toFixed(2)}B)`,
        });
      }
    }
  }

  const priceChange = current.price.change24hPct;
  if (typeof priceChange === 'number' && Math.abs(priceChange) >= THRESHOLDS.solPriceMovePct) {
    flags.push({
      severity: 'info',
      metric: 'sol_price_move',
      message: `SOL moved ${priceChange}% in the last 24h`,
    });
  }

  return { thresholds: THRESHOLDS, flags };
}
