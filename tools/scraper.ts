import * as https from "https";
import * as http from "http";

function fetchUrl(url: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Spectatr/1.0)" } }, (res) => {
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

function extractArticleText(html: string): string {
  // Remove scripts, styles, nav, header, footer, aside
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");

  // Try to extract <article> content first
  const articleMatch = text.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  if (articleMatch) text = articleMatch[1];

  // Extract paragraph text
  const paragraphs: string[] = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRe.exec(text)) !== null) {
    const clean = m[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
      .replace(/&#\d+;/g, "").replace(/\s+/g, " ")
      .trim();
    if (clean.length > 30) paragraphs.push(clean);
  }

  return paragraphs.join("\n\n").slice(0, 2000);
}

export async function scrapeArticles(
  urls: string[]
): Promise<{ url: string; content: string; success: boolean }[]> {
  const results = await Promise.allSettled(
    urls.slice(0, 5).map(async (url) => {
      const html = await fetchUrl(url);
      const content = extractArticleText(html);
      return { url, content, success: content.length > 100 };
    })
  );

  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { url: urls[i], content: "", success: false }
  );
}
