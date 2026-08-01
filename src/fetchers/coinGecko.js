async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

export async function getPriceSnapshot() {
  const data = await getJson(
    'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true'
  );
  const sol = data.solana ?? {};
  return {
    priceUsd: sol.usd ?? null,
    change24hPct: sol.usd_24h_change !== undefined ? Number(sol.usd_24h_change.toFixed(2)) : null,
    marketCapUsd: sol.usd_market_cap ?? null,
    volume24hUsd: sol.usd_24h_vol ?? null,
  };
}
