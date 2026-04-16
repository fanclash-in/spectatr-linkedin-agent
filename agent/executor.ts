import * as fs from "fs";
import * as path from "path";
import { LinkedInClient } from "../tools/linkedin";
import { Storage } from "../tools/storage";
import { RSSFetcher } from "../tools/rss";
import { scrapeArticles } from "../tools/scraper";
import { analyzePostHistory } from "../tools/posthistory";

const linkedin = new LinkedInClient();
const storage = new Storage();
const rss = new RSSFetcher();
const today = new Date().toISOString().split("T")[0];

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  console.log(`  🔧 ${name}`);
  try {
    switch (name) {
      case "linkedin_get_campaigns":
        return JSON.stringify(await linkedin.getCampaigns());

      case "linkedin_get_analytics":
        return JSON.stringify(
          await linkedin.getAnalytics(
            { start: input.startDate as string, end: input.endDate as string },
            (input.granularity as string | undefined) ?? "DAILY"
          )
        );

      case "linkedin_get_posts": {
        const posts = await linkedin.getOrgPosts();
        storage.write("posts.json", posts);
        return JSON.stringify({ ok: true, count: (posts as unknown[]).length });
      }

      case "save_posts":
        // posts.json is already saved by linkedin_get_posts; this is a no-op
        return JSON.stringify({ ok: true });

      case "linkedin_get_creatives":
        return JSON.stringify(await linkedin.getCreatives());

      case "read_history": {
        const h = storage.read<unknown[]>("history.json", []);
        return JSON.stringify(
          h.slice(-Math.min((input.days as number) || 30, 90))
        );
      }

      case "save_metrics":
        storage.write("metrics.json", { date: today, ...input });
        storage.appendHistory({ date: today, kpis: input.kpis });
        return JSON.stringify({ ok: true });

      case "save_suggestions": {
        const inc = ((input.suggestions as unknown[]) || []).map((s, i) => ({
          id: `sug_${today}_${i}`,
          date: today,
          status: "open",
          ...(s as object),
        }));
        const prev = storage
          .read<{ date?: string }[]>("suggestions.json", [])
          .filter((s) => s.date !== today);
        storage.write("suggestions.json", [...inc, ...prev].slice(0, 300));
        const meta = storage.read<Record<string, unknown>>("meta.json", {});
        meta.lastRun = new Date().toISOString();
        meta.lastSuggestionCount = inc.length;
        storage.write("meta.json", meta);
        return JSON.stringify({ ok: true, count: inc.length });
      }

      case "save_copy_variants": {
        const inc = ((input.variants as unknown[]) || []).map((v) => ({
          date: today,
          ...(v as object),
        }));
        const prev = storage
          .read<{ date?: string }[]>("copy_variants.json", [])
          .filter((v) => v.date !== today);
        storage.write("copy_variants.json", [...inc, ...prev].slice(0, 60));
        return JSON.stringify({ ok: true });
      }

      case "save_new_audiences": {
        const inc = ((input.audiences as unknown[]) || []).map((a) => ({
          date: today,
          ...(a as object),
        }));
        const prev = storage
          .read<{ date?: string }[]>("audiences.json", [])
          .filter((a) => a.date !== today);
        storage.write("audiences.json", [...inc, ...prev].slice(0, 40));
        return JSON.stringify({ ok: true });
      }

      case "save_report": {
        const dir = path.join(__dirname, "../reports");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, `${today}.md`),
          input.markdown as string
        );
        console.log(`  📄 reports/${today}.md`);
        return JSON.stringify({ ok: true });
      }

      case "fetch_sports_news":
        return JSON.stringify(await rss.fetchNews());

      case "scrape_article":
        return JSON.stringify(await scrapeArticles((input.urls as string[]) || []));

      case "read_post_history":
        return JSON.stringify(analyzePostHistory(14));

      case "save_generated_posts": {
        let posts: unknown = input.posts;
        // Unwrap any string encoding Claude may introduce
        while (typeof posts === "string") { try { posts = JSON.parse(posts); } catch { break; } }
        if (!Array.isArray(posts)) posts = [];
        const postsArr = posts as unknown[];
        const existing = storage.read<{ date: string; posts: unknown[] }[]>("generated_posts.json", []);
        const filtered = existing.filter((r) => r.date !== today);
        filtered.push({ date: today, posts: postsArr });
        filtered.sort((a, b) => b.date.localeCompare(a.date));
        storage.write("generated_posts.json", filtered.slice(0, 30));
        return JSON.stringify({ ok: true, count: (posts as unknown[]).length });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${name}: ${msg}`);
    return JSON.stringify({ error: msg });
  }
}
