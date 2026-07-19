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

export const bingRssFixture = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0" xmlns:News="https://www.bing.com/news/search?q=RGA&amp;format=rss"><channel>
<item>
<title>Reinsurance Group of America prices senior notes offering</title>
<link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=abc123&amp;url=https%3a%2f%2fwww.example.com%2frga-notes-offering&amp;c=123&amp;mkt=en-us</link>
<pubDate>Mon, 13 Jul 2026 15:00:00 GMT</pubDate>
<description>RGA priced an offering of senior notes.</description>
<News:Source>Example Wire</News:Source>
</item>
<item>
<title>Insurance stocks steady</title>
<link>https://www.example.org/insurance-stocks-steady</link>
<pubDate>Mon, 13 Jul 2026 14:00:00 GMT</pubDate>
</item>
</channel></rss>`;

export const tickerTickJsonFixture = JSON.stringify({
  stories: [
    {
      id: "4625325638577689532",
      title: "Reinsurance Group of America (NYSE:RGA) Hits New 1-Year High",
      url: "https://www.marketbeat.com/instant-alerts/rga-hits-new-1-year-high-2026-07-13/",
      site: "marketbeat.com",
      time: 1783954841000,
      description: "RGA reaches a new 52-week high.",
      tickers: ["rga"],
    },
    {
      id: "-8156895688729312614",
      title: "Q1 Earnings Outperformers: RGA and reinsurance peers",
      url: "https://www.stockstory.org/us/stocks/rga-q1-earnings",
      site: "stockstory.org",
      time: 1783868441000,
      tickers: ["rga", "eg"],
    },
  ],
  last_id: "-8156895688729312614",
});

export const gdeltJsonFixture = JSON.stringify({
  articles: [
    {
      url: "https://www.example.com/global-reinsurance-outlook",
      url_mobile: "",
      title: "Global reinsurance outlook improves",
      seendate: "20260713T221500Z",
      socialimage: "",
      domain: "example.com",
      language: "English",
      sourcecountry: "United States",
    },
    {
      url: "https://news.example.net/rga-expansion",
      title: "Reinsurance Group of America expands in Asia",
      seendate: "20260712T081000Z",
      domain: "news.example.net",
      language: "English",
      sourcecountry: "Japan",
    },
  ],
});

export const hackerNewsJsonFixture = JSON.stringify({
  hits: [
    {
      objectID: "48913906",
      title: "Insurance modeling with open data",
      url: "https://blog.example.com/insurance-modeling",
      author: "modeler",
      created_at: "2026-07-13T18:45:00.000Z",
    },
    {
      objectID: "48913907",
      title: "Ask HN: Best datasets for reinsurance research?",
      url: null,
      author: "asker",
      created_at: "2026-07-12T10:00:00.000Z",
    },
  ],
});

export const yahooSearchJsonFixture = JSON.stringify({
  explains: [],
  count: 2,
  quotes: [],
  news: [
    {
      uuid: "73168fbc-b9fd-3413-91d8-727fd1981c0c",
      title: "RGA Outperforms Industry, Hits 52-Week High",
      publisher: "Zacks",
      link: "https://finance.yahoo.com/markets/stocks/articles/rga-outperforms-industry.html",
      providerPublishTime: 1783954800,
      type: "STORY",
      relatedTickers: ["rga", "MFC"],
    },
    {
      uuid: "9f0f0f0f-0000-1111-2222-333344445555",
      title: "Reinsurance sector momentum continues",
      publisher: "Business Wire",
      link: "https://finance.yahoo.com/news/reinsurance-sector-momentum.html",
      providerPublishTime: 1783868400,
      type: "STORY",
    },
  ],
});

export const secFullTextJsonFixture = JSON.stringify({
  hits: {
    total: { value: 2, relation: "eq" },
    hits: [
      {
        _id: "0001193125-26-123456:d123456d8k.htm",
        _source: {
          ciks: ["0000898174"],
          display_names: ["Reinsurance Group of America, Incorporated  (RGA)  (CIK 0000898174)"],
          file_date: "2026-06-22",
          file_type: "8-K",
          form: "8-K",
          adsh: "0001193125-26-123456",
          file_description: "CURRENT REPORT",
        },
      },
    ],
  },
});

export const federalRegisterJsonFixture = JSON.stringify({
  count: 1,
  results: [
    {
      title: "Credit for Reinsurance Model Regulation Updates",
      type: "Rule",
      abstract: "Final rule updating credit for reinsurance requirements.",
      document_number: "2026-12345",
      html_url:
        "https://www.federalregister.gov/documents/2026/07/01/2026-12345/credit-for-reinsurance",
      publication_date: "2026-07-01",
      agencies: [{ name: "Treasury Department" }],
    },
  ],
});

export const courtListenerAtomFixture = `<?xml version="1.0" encoding="utf-8"?><feed xml:lang="en-us" xmlns="http://www.w3.org/2005/Atom">
<title>CourtListener.com Custom Search Feed</title>
<entry>
<title>In Re Reinsurance Group of America v. Example State</title>
<link href="https://www.courtlistener.com/opinion/1234567/rga-v-example-state/" rel="alternate"/>
<published>2026-06-20T00:00:00-07:00</published>
<author><name>Missouri Court of Appeals</name></author>
<id>https://www.courtlistener.com/opinion/1234567/rga-v-example-state/</id>
<summary type="html">&lt;p&gt;Credit for reinsurance dispute involving the insurance group.&lt;/p&gt;</summary>
</entry>
</feed>`;

export const nasdaqRssFixture = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>
<item>
<title>RGA Outperforms Industry After Strong Quarter</title>
<link>https://www.nasdaq.com/articles/rga-outperforms-industry-after-strong-quarter</link>
<description>Reinsurance Group of America rallies on solid results.</description>
<pubDate>Tue, 14 Jul 2026 13:57:00 +0000</pubDate>
<guid isPermaLink="true">https://www.nasdaq.com/articles/rga-outperforms-industry-after-strong-quarter</guid>
</item>
</channel></rss>`;

export const seekingAlphaRssFixture = `<?xml version="1.0"?><rss xmlns:sa="https://seekingalpha.com/api/1.0" version="2.0"><channel>
<title>Reinsurance Group of America</title>
<link>https://seekingalpha.com</link>
<item>
<title>Reinsurance Group of America appoints new CFO</title>
<link>https://seekingalpha.com/symbol/RGA/news?source=feed_symbol_RGA</link>
<guid isPermaLink="false">https://seekingalpha.com/MarketCurrent:4605518</guid>
<pubDate>Mon, 22 Jun 2026 09:17:40 -0400</pubDate>
</item>
<item>
<title>RGA Q1 results: financial instruments after RZB redemption</title>
<link>https://seekingalpha.com/article/4904996-rga-q1-financial-instruments?source=feed_symbol_RGA</link>
<guid isPermaLink="false">https://seekingalpha.com/article/4904996</guid>
<pubDate>Sun, 21 Jun 2026 08:00:00 -0400</pubDate>
</item>
</channel></rss>`;

export const marketFeedRssFixture = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<item>
<title>Reinsurance Group of America raises dividend</title>
<link>https://www.example-market.com/rga-dividend</link>
<description>The insurer boosted its quarterly payout.</description>
<pubDate>Tue, 14 Jul 2026 12:00:00 GMT</pubDate>
</item>
<item>
<title>Insurers rally as rates stabilize (NYSE:RGA)</title>
<link>https://www.example-market.com/insurers-rally</link>
<description>Life and health insurers led gains.</description>
<pubDate>Tue, 14 Jul 2026 11:00:00 GMT</pubDate>
</item>
<item>
<title>ARGAN wins construction award</title>
<link>https://www.example-market.com/argan-award</link>
<description>Unrelated industrial story about insurance regulation trends.</description>
<pubDate>Tue, 14 Jul 2026 10:00:00 GMT</pubDate>
</item>
</channel></rss>`;

export const emptyRssFixture = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>empty</title></channel></rss>`;

export const secCurrentAtomFixture = `<?xml version="1.0" encoding="ISO-8859-1" ?><feed xmlns="http://www.w3.org/2005/Atom">
<title>Latest Filings - Tue, 14 Jul 2026 20:42:30 EDT</title>
<entry>
<title>8-K - Reinsurance Group of America, Incorporated (0000898174) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/898174/000089817426000042/0000898174-26-000042-index.htm"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-07-14 &lt;b&gt;AccNo:&lt;/b&gt; 0000898174-26-000042 &lt;b&gt;Size:&lt;/b&gt; 155 KB</summary>
<updated>2026-07-14T17:30:29-04:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="8-K"/>
<id>urn:tag:sec.gov,2008:accession-number=0000898174-26-000042</id>
</entry>
<entry>
<title>4 - Insurance Holdings Corp (0001234567) (Issuer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1234567/000123456726000010/0001234567-26-000010-index.htm"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-07-14 &lt;b&gt;AccNo:&lt;/b&gt; 0001234567-26-000010 &lt;b&gt;Size:&lt;/b&gt; 5 KB</summary>
<updated>2026-07-14T16:00:00-04:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="4"/>
<id>urn:tag:sec.gov,2008:accession-number=0001234567-26-000010</id>
</entry>
</feed>`;

export const msrbEmmaJsonFixture = JSON.stringify({
  status: 0,
  data: [
    {
      PostingDateTime: "/Date(1784330025000)/",
      IssuerName: "HOCKING TECHNICAL COLLEGE OHIO GEN RCPTS",
      DisclosureCategories: "Rating Change",
      ConfirmationFlag: true,
      SubmissionId: "P21552419",
      DocumentId: "P21570438",
      TransactionId: "P22065663",
      SecondaryMarketType: "CD",
      CdDetailsUrl: "../MarketActivity/ContinuingDisclosureDetails/P21552419",
      CdDocumentUrl: "/P22065663-P21570438-.pdf",
      DisclosureDescriptions: "Rating Change",
      IsModified: false,
    },
    {
      PostingDateTime: "/Date(1784431894000)/",
      IssuerName: "UTAH COUNTY UTAH TRANSN SALES TAX REV",
      DisclosureCategories:
        "Annual Financial Information and Operating Data, Audited Financial Statements or ACFR",
      ConfirmationFlag: true,
      SubmissionId: "P21552429",
      DocumentId: "P21570448",
      TransactionId: "P22065676",
      SecondaryMarketType: "CD",
      CdDetailsUrl: "../MarketActivity/ContinuingDisclosureDetails/P21552429",
      CdDocumentUrl: "/P22065676-P21570448-.pdf",
      DisclosureDescriptions:
        "Annual Financial Information and Operating Data, Audited Financial Statements or ACFR",
      IsModified: false,
    },
    {
      PostingDateTime: "/Date(1784259000000)/",
      IssuerName: "EXAMPLE CITY WATER & SEWER AUTH",
      DisclosureCategories: "Bond Call",
      ConfirmationFlag: false,
      SubmissionId: "P21552001",
      DocumentId: "P21570001",
      TransactionId: "P22065001",
      SecondaryMarketType: "CD",
      CdDetailsUrl: "../MarketActivity/ContinuingDisclosureDetails/{0}",
      CdDocumentUrl: "/P22065001-P21570001-.pdf",
      DisclosureDescriptions: "Bond Call",
      IsModified: true,
    },
    {
      PostingDateTime: "/Date(1784259000000)/",
      IssuerName: "",
      DisclosureCategories: "Bond Call",
      SubmissionId: "P21552002",
    },
  ],
});
