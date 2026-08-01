async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

export async function getDefiSnapshot() {
  const [chains, stablecoinChains] = await Promise.all([
    getJson('https://api.llama.fi/v2/chains'),
    getJson('https://stablecoins.llama.fi/stablecoinchains'),
  ]);

  const solanaChain = chains.find((c) => c.name === 'Solana') ?? null;
  const solanaStables = stablecoinChains.find((c) => c.name === 'Solana') ?? null;

  const totalTvlAllChains = chains.reduce((sum, c) => sum + (c.tvl || 0), 0);
  const tvlRank = chains
    .slice()
    .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
    .findIndex((c) => c.name === 'Solana') + 1;

  return {
    tvlUsd: solanaChain?.tvl ?? null,
    tvlRankAmongChains: tvlRank || null,
    tvlShareOfAllChainsPct: solanaChain?.tvl && totalTvlAllChains
      ? Number(((solanaChain.tvl / totalTvlAllChains) * 100).toFixed(2))
      : null,
    stablecoinSupplyUsd: solanaStables?.totalCirculatingUSD?.peggedUSD ?? null,
  };
}
