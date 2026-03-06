import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS } from "./tools";
import { executeTool } from "./executor";
import { postSlack } from "../tools/slack";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const today = new Date().toISOString().split("T")[0];
const yest = new Date(Date.now() - 86_400_000).toISOString().split("T")[0];
const week_ago = new Date(Date.now() - 7 * 86_400_000)
  .toISOString()
  .split("T")[0];

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
      content: `Today is ${today}. Yesterday: ${yest}. 7 days ago: ${week_ago}.

Run the full daily LinkedIn ad analysis for Spectatr.ai:
1. linkedin_get_campaigns
2. linkedin_get_analytics(${week_ago}, ${today}) ← 7-day window
3. linkedin_get_analytics(${yest}, ${today}) ← day-over-day
4. linkedin_get_creatives
5. read_history(30)
6. Analyse: CTR drops, CPL spikes, frequency fatigue, top performers
7. save_metrics — KPIs, campaign table, 7-day trend arrays, alerts, opportunities
8. save_suggestions — HIGH priority first, every item cites exact metric + delta
9. save_copy_variants — 3 headlines + 2 body copies per flagged ad
10. save_new_audiences — 2-3 Spectatr-specific segments, ready-to-launch copy
11. save_report — full markdown narrative

All 5 save_ calls are required. Be specific — cite exact numbers.`,
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
