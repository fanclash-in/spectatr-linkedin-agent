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
const thirty_ago = new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0];
const month_start = new Date().toISOString().slice(0, 8) + "01";

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
      content: `Today is ${today}. Yesterday: ${yest}. 7 days ago: ${week_ago}. 14 days ago: ${prev_week}. 30 days ago: ${thirty_ago}. Month start: ${month_start}.

Run the full daily LinkedIn ad analysis for Spectatr.ai.

STEP 1 — call linkedin_get_campaigns FIRST and wait for the result.
  Collect the numeric id of every returned campaign — used to match analytics rows to names.

STEP 2 — call all five in parallel after STEP 1 completes:
  a. linkedin_get_analytics(startDate=${week_ago}, endDate=${yest}, granularity=DAILY)
     → 7-day window (complete days only); one row per campaign per day — SUM for totals
  b. linkedin_get_analytics(startDate=${prev_week}, endDate=${week_ago}, granularity=ALL)
     → prior 7-day window; one aggregated row per campaign — use as WoW baseline
  c. linkedin_get_analytics(startDate=${thirty_ago}, endDate=${yest}, granularity=ALL)
     → last 30 days; one aggregated row per campaign — save as kpis30d / camps30d
  d. linkedin_get_analytics(startDate=${month_start}, endDate=${yest}, granularity=ALL)
     → month-to-date; one aggregated row per campaign — save as kpisMtd / campsMtd
  e. linkedin_get_creatives

STEP 3 — call read_history(30) to get historical daily snapshots.

DATA PROCESSING RULES (strictly follow):

CAMPAIGN SCOPE (critical — prevents cross-account data):
- From STEP 1, collect the numeric id of every campaign (e.g. 12345678).
- For every analytics row from any call, extract the numeric ID from pivotValues[0]:
  "urn:li:sponsoredCampaign:12345678" → 12345678
- ONLY process rows whose numeric ID is in the STEP 1 campaign ID list.
  Silently discard any row with an unrecognised ID — it belongs to another account.

CAMPAIGN NAMES (strict — no exceptions):
- The name field in every save_metrics campaigns[] entry MUST be the exact string
  from the getCampaigns API name field. Copy it character-for-character.
- NEVER rename, abbreviate, clean up, or remap to product names (PULSE, AXIS, etc.).
- NEVER invent a campaign name. Use only names that appear in the STEP 1 response.

METRICS AGGREGATION (SUM all rows per campaign ID — never use a single row):
- Impressions: SUM impressions across all rows for the campaign in the date window.
- Clicks: SUM clicks across all rows.
- Spend: SUM costInLocalCurrency. Currency is INR (Rs).
- CTR %: (total clicks / total impressions) x 100. Always compute from counts.
- Leads: SUM oneClickLeads if present and > 0; otherwise SUM externalWebsiteConversions.
- CPL: total spend / total leads per campaign (null if leads = 0).
- Frequency: total impressions / total approximateUniqueImpressions per campaign (7d only).
- WoW delta %: ((current - prior) / prior) x 100. Use STEP 2b data as prior. Never estimate.
- Trend arrays: Build from history.json daily snapshots (read_history result), ordered date ascending.

SAVING MULTIPLE WINDOWS — include all four in save_metrics:
- kpis: account-level totals for the 7d window (with WoW deltas)
- campaigns: per-campaign metrics for the 7d window (with WoW deltas)
- kpis30d: same shape as kpis but from the 30d window; omit delta fields (set to null)
- camps30d: same shape as campaigns but from the 30d window; omit delta fields (set to null)
- kpisMtd: same shape as kpis but from the MTD window; omit delta fields (set to null)
- campsMtd: same shape as campaigns but from the MTD window; omit delta fields (set to null)
  If month_start = yest (1st of month edge case), set kpisMtd and campsMtd to null.

IF ANALYTICS RETURNS AN ERROR:
- Record the error in alerts with type 'r' (red).
- Set all per-campaign spend/ctr/cpl/leads/freq to null.
- Never fabricate or estimate metrics.

STEP 4 — save_metrics, save_suggestions, save_copy_variants, save_new_audiences, save_report

All 5 save_ calls are required. Use exact API numbers. Never round or estimate metrics.`,
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
