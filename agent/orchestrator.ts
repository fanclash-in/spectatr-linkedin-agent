import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS } from "./tools";
import { executeTool } from "./executor";
import { postSlack } from "../tools/slack";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const today = new Date().toISOString().split("T")[0];
const yest = new Date(Date.now() - 86_400_000).toISOString().split("T")[0];
const week_ago = new Date(Date.now() - 7 * 86_400_000).toISOString().split("T")[0];
const prev_week = new Date(Date.now() - 14 * 86_400_000).toISOString().split("T")[0];

async function run(): Promise<void> {
  console.log(`\n${"═".repeat(52)}`);
  console.log(`  🚀 Spectatr.ai Ad Analyst · ${today}`);
  console.log(`${"═".repeat(52)}\n`);

  const system = fs.readFileSync(
    path.join(__dirname, "../CLAUDE.md"),
    "utf-8"
  );

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Today is ${today}. Yesterday: ${yest}. 7 days ago: ${week_ago}. 14 days ago: ${prev_week}.

Run the full daily LinkedIn ad analysis for Spectatr.ai.

STEP 1 — call linkedin_get_campaigns FIRST and wait for the result.

STEP 2 — from the campaigns response, extract every campaign URN in the format urn:li:sponsoredCampaign:ID (the id field, or embedded in the element URN). Build an array of these URNs — you will pass it to EVERY analytics call.

STEP 3 — call these three in parallel, passing the campaignUrns array from step 2 to each:
  a. linkedin_get_analytics(startDate=${week_ago}, endDate=${today}, granularity=DAILY, campaignUrns=[...])
     → current 7-day window; daily rows for trend arrays + per-campaign totals (SUM each field across all 7 rows per campaign)
  b. linkedin_get_analytics(startDate=${prev_week}, endDate=${week_ago}, granularity=ALL, campaignUrns=[...])
     → prior 7-day window; already aggregated — use for WoW delta calculation
  c. linkedin_get_creatives

STEP 4 — call read_history(30)

DATA PROCESSING RULES (strictly follow):
- Impressions: SUM the impressions field across all daily rows for each campaign (granularity=DAILY returns one row per campaign per day — you must add them up)
- Clicks: same — SUM across daily rows per campaign
- Spend: SUM costInLocalCurrency across daily rows per campaign (currency is INR ₹)
- CTR: total clicks / total impressions × 100 (always compute from raw counts — clickThroughRate is not in the response)
- Leads: use oneClickLeads if present and > 0; otherwise use externalWebsiteConversions. SUM across daily rows.
- CPL: total spend / total leads per campaign
- Frequency: total impressions / total approximateUniqueImpressions per campaign
- WoW delta: ((current value − prior value) / prior value) × 100 — use step 3b as prior week baseline
- Trend arrays: 7 data points from step 3a, one per date, ordered ascending — use account-level CTR and CPL averages

STEP 5 — save_metrics, save_suggestions, save_copy_variants, save_new_audiences, save_report

All 5 save_ calls are required. Cite exact numbers (e.g. ₹12,090.57 not rounded). Do not estimate any metric.`,
    },
  ];

  let iter = 0;
  let res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8096,
    system,
    tools: TOOLS,
    messages,
  });

  while (res.stop_reason === "tool_use" && iter < 30) {
    iter++;
    const calls = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    console.log(`\n[Turn ${iter}] ${calls.map((c) => c.name).join(", ")}`);
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const c of calls) {
      results.push({
        type: "tool_result",
        tool_use_id: c.id,
        content: await executeTool(
          c.name,
          c.input as Record<string, unknown>
        ),
      });
    }
    messages.push({ role: "user", content: results });
    res = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8096,
      system,
      tools: TOOLS,
      messages,
    });
  }

  const summary = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .slice(0, 600);

  console.log(`\n${"─".repeat(52)}`);
  console.log(`  ✅ Done in ${iter} turns`);
  console.log(`${"─".repeat(52)}\n`);

  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const dashUrl = owner
    ? `https://${owner}.github.io/spectatr-linkedin-agent/`
    : "your GitHub Pages dashboard";

  await postSlack(
    `*Spectatr.ai LinkedIn Report — ${today}*\n\n${summary}\n\n_Dashboard: ${dashUrl}_`
  );
}

run().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
