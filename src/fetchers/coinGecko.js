async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

// Single richer endpoint instead of /simple/price: also carries circulating/total
// supply, which doubles as a reliable fallback for Solana RPC's getSupply -- that
// RPC method hangs or is restricted on every free public endpoint we tested, while
// this CoinGecko field agrees with it (verified) and just works.
export async function getMarketSnapshot() {
  const data = await getJson(
    'https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false'
  );
  const m = data.market_data ?? {};
  return {
    priceUsd: m.current_price?.usd ?? null,
    change24hPct: m.price_change_percentage_24h !== undefined ? Number(m.price_change_percentage_24h.toFixed(2)) : null,
    marketCapUsd: m.market_cap?.usd ?? null,
    volume24hUsd: m.total_volume?.usd ?? null,
    circulatingSupplySol: m.circulating_supply ?? null,
    totalSupplySol: m.total_supply ?? null,
  };
}
