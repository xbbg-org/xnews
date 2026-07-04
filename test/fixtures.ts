export const yahooRssFixture = `<?xml version="1.0"?><rss><channel>
<item>
<title><![CDATA[Laura Cockrill Named Chief Financial Officer, RGA]]></title>
<link>https://finance.yahoo.com/markets/stocks/articles/laura-cockrill-named-chief-financial-130000000.html</link>
<guid isPermaLink="false">abc-123</guid>
<pubDate>Mon, 22 Jun 2026 13:00:00 +0000</pubDate>
<source url="https://finance.yahoo.com">Business Wire</source>
<description><![CDATA[RGA announced a CFO transition.]]></description>
</item>
</channel></rss>`;

export const googleRssFixture = `<?xml version="1.0"?><rss><channel>
<item>
<title><![CDATA[RGA names new director - Business Wire]]></title>
<link>https://news.google.com/rss/articles/rga-director</link>
<guid isPermaLink="false">google-rga-1</guid>
<pubDate>Tue, 23 Jun 2026 14:30:00 +0000</pubDate>
<source url="https://www.businesswire.com">Business Wire</source>
<description><![CDATA[RGA board update.]]></description>
</item>
</channel></rss>`;

export const secAtomFixture = `<?xml version="1.0" encoding="ISO-8859-1"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry>
<title>8-K - Reinsurance Group of America, Incorporated</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/898174/000119312526123456/d123456d8k.htm" />
<updated>2026-06-22T16:20:31-04:00</updated>
<summary>Current report filing.</summary>
<filing-type>8-K</filing-type>
<accession-number>0001193125-26-123456</accession-number>
</entry>
</feed>`;

export const finvizFixture = `<table id="news-table" data-ticker="RGA">
<tr class="cursor-pointer has-label"><td width="130" align="right">Jul-01-26 04:15PM</td><td align="left"><a class="tab-link-news" href="https://www.businesswire.com/news/home/20260701565020/en">Reinsurance Group of America Names New Member to Board of Directors</a><span>(Business Wire)</span></td></tr>
<tr class="cursor-pointer has-label"><td width="130" align="right">09:00AM</td><td align="left"><a class="tab-link-news" href="/news/123/rga-analysis">RGA analysis headline</a><span>(Zacks)</span></td></tr>
</table>`;

export const finvizSpanSourceFixture = `<table id="news-table" data-ticker="RGA">
<tr class="cursor-pointer has-label"><td width="130" align="right">Jul-02-26 08:00AM</td><td align="left"><a class="tab-link-news" href="/news/456/rga-zacks">RGA stock gains after analyst note</a><span class="news-source">Zacks</span></td></tr>
</table>`;
