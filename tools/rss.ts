import * as https from "https";
import * as http from "http";

const FEEDS: { url: string; source: string }[] = [
  // Core sports business
  { url: "https://www.sportspromedia.com/feed/",       source: "SportsPro" },
  { url: "https://frontofficesports.com/feed/",        source: "Front Office Sports" },
  { url: "https://sportico.com/feed/",                 source: "Sportico" },
  { url: "https://insidersport.com/feed/",             source: "Insider Sport" },
  { url: "https://www.sportbusiness.com/feed/",        source: "SportBusiness" },
  { url: "https://www.sportcal.com/feed/",             source: "Sportcal" },
  // Sports production & broadcast tech
  { url: "https://www.svgeurope.org/feed/",            source: "SVG Europe" },
  { url: "https://www.sportsvideo.org/feed/",          source: "Sports Video Group" },
  { url: "https://advanced-television.com/feed",       source: "Advanced Television" },
  { url: "https://www.tvbeurope.com/feed",             source: "TVB Europe" },
  { url: "https://www.cablefax.com/feed",              source: "Cablefax" },
];

export interface RSSArticle {
  title: string;
  description: string;
  link: string;
  source: string;
  pubDate: string;
  pubTs: number;
}

function getText(xml: string, tag: string): string {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#\d+;/g, "").replace(/\s+/g, " ").trim();
}

function fetchUrl(url: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0 (RSS reader)" } }, (res) => {
      // follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        fetchUrl(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

function parseFeed(xml: string, source: string): RSSArticle[] {
  const articles: RSSArticle[] = [];
  // Split by <item> or <entry> (Atom feeds)
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1] ?? match[2] ?? "";
    const title = stripHtml(getText(block, "title"));
    const description = stripHtml(getText(block, "description") || getText(block, "summary") || getText(block, "content"));
    const link = getText(block, "link") || block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] || "";
    const pubDate = getText(block, "pubDate") || getText(block, "published") || getText(block, "updated") || "";
    if (!title) continue;
    const pubTs = pubDate ? new Date(pubDate).getTime() : 0;
    articles.push({ title, description: description.slice(0, 800), link, source, pubDate, pubTs });
  }
  return articles;
}

export class RSSFetcher {
  async fetchNews(): Promise<RSSArticle[]> {
    const results = await Promise.allSettled(
      FEEDS.map(({ url, source }) =>
        fetchUrl(url).then((xml) => parseFeed(xml, source)).catch(() => [] as RSSArticle[])
      )
    );

    const all: RSSArticle[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
    }

    // Sort by pubDate descending, return top 25
    all.sort((a, b) => b.pubTs - a.pubTs);
    return all.slice(0, 25);
  }
}
