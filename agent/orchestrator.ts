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
  Note the numeric id of every returned campaign — used to match analytics rows to campaign names.

STEP 2 — call these three in parallel (analytics is account-scoped server-side via accounts[0]):
  a. linkedin_get_analytics(startDate=${week_ago}, endDate=${today}, granularity=DAILY)
     → current 7-day window; one row per campaign per day
  b. linkedin_get_analytics(startDate=${prev_week}, endDate=${week_ago}, granularity=ALL)
     → prior 7-day window; one aggregated row per campaign — use for WoW delta
  c. linkedin_get_creatives

STEP 3 — call read_history(30)

DATA PROCESSING RULES (strictly follow):

CAMPAIGN SCOPE (critical — prevents cross-account data):
- From STEP 1, collect the numeric id of every campaign returned (e.g. 12345678).
- For every analytics row, extract the numeric ID from pivotValues[0]:
  "urn:li:sponsoredCampaign:12345678" = 12345678
- ONLY process analytics rows whose numeric ID is in the STEP 1 campaign ID list.
  Silently discard any row with an unrecognised ID — it belongs to another account.

CAMPAIGN NAMES (strict — no exceptions):
- The name field in every save_metrics campaigns[] entry MUST be the exact string
  from the getCampaigns API name field. Copy it character-for-character.
- NEVER rename, abbreviate, clean up, or remap to product names (PULSE, AXIS, etc.).
- NEVER invent a campaign name. Use only names that appear in the STEP 1 response.

METRICS AGGREGATION:
- Impressions: SUM impressions across all daily rows per campaign ID. Do NOT use a single row.
- Clicks: SUM across daily rows per campaign ID.
- Spend: SUM costInLocalCurrency across daily rows per campaign ID. Currency is INR ₹.
- CTR %: (total clicks ÷ total impressions) × 100. clickThroughRate is absent — always compute from counts.
- Leads: use oneClickLeads if present and > 0; otherwise use externalWebsiteConversions. SUM across daily rows.
- CPL: total spend ÷ total leads per campaign.
- Frequency: total impressions ÷ total approximateUniqueImpressions per campaign.
- WoW delta %: ((current − prior) ÷ prior) × 100. Use STEP 2b as prior baseline. Never estimate.
- Trend arrays: 7 data points ordered by date ascending, account-level avgCtr and avgCpl per day.

STEP 4 — save_metrics, save_suggestions, save_copy_variants, save_new_audiences, save_report

All 5 save_ calls are required. Use exact API numbers (e.g. ₹12,090.57 not rounded). Never carry over or estimate metrics.`,
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
