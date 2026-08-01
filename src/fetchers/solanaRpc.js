// api.mainnet-beta.solana.com actively 403s requests from some origins (confirmed
// against this project's own GitHub Pages deploy). solana-rpc.publicnode.com is the
// verified-working default. getSupply in particular is unreliable across every free
// public RPC we tested (timeouts or explicit restrictions), so every call here is
// independently timeboxed and allowed to fail without taking the rest of the report
// down with it -- a report with one field missing beats a report that never loads.
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com';
const CALL_TIMEOUT_MS = 8000;

let idCounter = 1;

async function rpcCall(method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: idCounter++, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`RPC ${method} HTTP ${res.status}`);
    }
    const body = await res.json();
    if (body.error) {
      throw new Error(`RPC ${method} error: ${body.error.message}`);
    }
    return body.result;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`RPC ${method} timed out after ${CALL_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Returns { ok: true, value } or { ok: false, error }. Never throws.
async function rpcCallSafe(method, params = []) {
  try {
    return { ok: true, value: await rpcCall(method, params) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function getNetworkSnapshot() {
  const [epochInfoR, healthR, perfR, supplyR, voteAccountsR] = await Promise.all([
    rpcCallSafe('getEpochInfo'),
    rpcCallSafe('getHealth'),
    rpcCallSafe('getRecentPerformanceSamples', [30]),
    rpcCallSafe('getSupply', [{ excludeNonCirculatingAccountsList: true }]),
    rpcCallSafe('getVoteAccounts'),
  ]);

  const warnings = [epochInfoR, healthR, perfR, supplyR, voteAccountsR]
    .filter((r) => !r.ok)
    .map((r) => r.error);

  const epochInfo = epochInfoR.ok ? epochInfoR.value : null;
  const health = healthR.ok ? healthR.value : `unavailable: ${healthR.error}`;
  const perfSamples = perfR.ok ? perfR.value : [];
  const supply = supplyR.ok ? supplyR.value : null;
  const voteAccounts = voteAccountsR.ok ? voteAccountsR.value : null;

  const totalTx = perfSamples.reduce((sum, s) => sum + s.numTransactions, 0);
  const totalSecs = perfSamples.reduce((sum, s) => sum + s.samplePeriodSecs, 0);
  const totalNonVoteTx = perfSamples.reduce((sum, s) => sum + (s.numNonVoteTransactions ?? 0), 0);
  const avgTps = totalSecs > 0 ? totalTx / totalSecs : null;
  const avgNonVoteTps = totalSecs > 0 ? totalNonVoteTx / totalSecs : null;
  const latestSample = perfSamples[0] ?? null;
  const latestSampleTps = latestSample ? latestSample.numTransactions / latestSample.samplePeriodSecs : null;

  let validators = {
    current: null, delinquent: null, total: null, delinquencyPct: null,
    nakamotoCoefficient: null, topValidators: [],
  };

  if (voteAccounts) {
    const currentValidators = voteAccounts.current.length;
    const delinquentValidators = voteAccounts.delinquent.length;
    const totalValidators = currentValidators + delinquentValidators;
    const delinquencyPct = totalValidators > 0 ? (delinquentValidators / totalValidators) * 100 : 0;

    const allActive = voteAccounts.current.slice().sort((a, b) => b.activatedStake - a.activatedStake);
    const totalActiveStake = allActive.reduce((sum, v) => sum + v.activatedStake, 0);
    const topValidators = allActive.slice(0, 10).map((v) => ({
      votePubkey: v.votePubkey,
      nodePubkey: v.nodePubkey,
      activatedStakeSol: v.activatedStake / LAMPORTS_PER_SOL,
      commission: v.commission,
      stakeSharePct: totalActiveStake > 0 ? (v.activatedStake / totalActiveStake) * 100 : 0,
    }));

    // Nakamoto coefficient: minimum number of validators (by stake, descending)
    // whose combined stake exceeds 33.3% of total active stake (enough to halt consensus).
    let running = 0;
    let nakamotoCoefficient = 0;
    for (const v of allActive) {
      running += v.activatedStake;
      nakamotoCoefficient++;
      if (running / totalActiveStake > 1 / 3) break;
    }

    validators = {
      current: currentValidators,
      delinquent: delinquentValidators,
      total: totalValidators,
      delinquencyPct: Number(delinquencyPct.toFixed(2)),
      nakamotoCoefficient,
      topValidators,
    };
  }

  const supplyValue = supply ? (supply.value ?? supply) : null;

  return {
    fetchedAt: new Date().toISOString(),
    warnings,
    epoch: epochInfo ? {
      epoch: epochInfo.epoch,
      slotIndex: epochInfo.slotIndex,
      slotsInEpoch: epochInfo.slotsInEpoch,
      progressPct: (epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100,
      absoluteSlot: epochInfo.absoluteSlot,
      blockHeight: epochInfo.blockHeight,
    } : null,
    health,
    performance: {
      avgTps: avgTps !== null ? Number(avgTps.toFixed(1)) : null,
      avgNonVoteTps: avgNonVoteTps !== null ? Number(avgNonVoteTps.toFixed(1)) : null,
      latestSampleTps: latestSampleTps !== null ? Number(latestSampleTps.toFixed(1)) : null,
      sampleWindowCount: perfSamples.length,
    },
    supply: supplyValue ? {
      totalSol: supplyValue.total / LAMPORTS_PER_SOL,
      circulatingSol: supplyValue.circulating / LAMPORTS_PER_SOL,
      nonCirculatingSol: supplyValue.nonCirculating / LAMPORTS_PER_SOL,
    } : null,
    validators,
  };
}
