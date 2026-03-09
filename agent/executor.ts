import * as fs from "fs";
import * as path from "path";
import { LinkedInClient } from "../tools/linkedin";
import { Storage } from "../tools/storage";

const linkedin = new LinkedInClient();
const storage = new Storage();
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

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${name}: ${msg}`);
    return JSON.stringify({ error: msg });
  }
}
