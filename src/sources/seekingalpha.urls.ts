export function seekingAlphaRssUrl(ticker: string): string {
  return `https://seekingalpha.com/api/sa/combined/${encodeURIComponent(ticker.toUpperCase())}.xml`;
}
