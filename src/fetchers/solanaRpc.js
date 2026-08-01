const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

let idCounter = 1;

async function rpcCall(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: idCounter++, method, params }),
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body.error) {
    throw new Error(`RPC ${method} error: ${body.error.message}`);
  }
  return body.result;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function getNetworkSnapshot() {
  const [epochInfo, health, perfSamples, supply, voteAccounts] = await Promise.all([
    rpcCall('getEpochInfo'),
    rpcCall('getHealth').catch((e) => `unhealthy: ${e.message}`),
    rpcCall('getRecentPerformanceSamples', [30]),
    rpcCall('getSupply', [{ excludeNonCirculatingAccountsList: true }]),
    rpcCall('getVoteAccounts'),
  ]);

  const totalTx = perfSamples.reduce((sum, s) => sum + s.numTransactions, 0);
  const totalSecs = perfSamples.reduce((sum, s) => sum + s.samplePeriodSecs, 0);
  const totalNonVoteTx = perfSamples.reduce((sum, s) => sum + (s.numNonVoteTransactions ?? 0), 0);
  const avgTps = totalSecs > 0 ? totalTx / totalSecs : null;
  const avgNonVoteTps = totalSecs > 0 ? totalNonVoteTx / totalSecs : null;
  const latestSample = perfSamples[0] ?? null;
  const latestSampleTps = latestSample ? latestSample.numTransactions / latestSample.samplePeriodSecs : null;

  const currentValidators = voteAccounts.current.length;
  const delinquentValidators = voteAccounts.delinquent.length;
  const totalValidators = currentValidators + delinquentValidators;
  const delinquencyPct = totalValidators > 0 ? (delinquentValidators / totalValidators) * 100 : 0;

  const allActive = voteAccounts.current
    .slice()
    .sort((a, b) => b.activatedStake - a.activatedStake);
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

  const supplyValue = supply.value ?? supply; // getSupply wraps its payload in {context, value}

  return {
    fetchedAt: new Date().toISOString(),
    epoch: {
      epoch: epochInfo.epoch,
      slotIndex: epochInfo.slotIndex,
      slotsInEpoch: epochInfo.slotsInEpoch,
      progressPct: (epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100,
      absoluteSlot: epochInfo.absoluteSlot,
      blockHeight: epochInfo.blockHeight,
    },
    health,
    performance: {
      avgTps: avgTps !== null ? Number(avgTps.toFixed(1)) : null,
      avgNonVoteTps: avgNonVoteTps !== null ? Number(avgNonVoteTps.toFixed(1)) : null,
      latestSampleTps: latestSampleTps !== null ? Number(latestSampleTps.toFixed(1)) : null,
      sampleWindowCount: perfSamples.length,
    },
    supply: {
      totalSol: supplyValue.total / LAMPORTS_PER_SOL,
      circulatingSol: supplyValue.circulating / LAMPORTS_PER_SOL,
      nonCirculatingSol: supplyValue.nonCirculating / LAMPORTS_PER_SOL,
    },
    validators: {
      current: currentValidators,
      delinquent: delinquentValidators,
      total: totalValidators,
      delinquencyPct: Number(delinquencyPct.toFixed(2)),
      nakamotoCoefficient,
      topValidators,
    },
  };
}
