import * as fs from "fs";
import * as path from "path";
import { GoogleGenerativeAI, Content, Part, FunctionCallPart, FunctionResponsePart } from "@google/generative-ai";
import { TOOLS } from "./tools";
import { executeTool } from "./executor";
import { postSlack } from "../tools/slack";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
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

  const systemInstruction = fs.readFileSync(
    path.join(__dirname, "../CLAUDE.md"),
    "utf-8"
  );

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction,
    tools: [{ functionDeclarations: TOOLS }],
  });

  const chat = model.startChat({ history: [] });

  const userPrompt = `Today is ${today}. Yesterday: ${yest}. 7 days ago: ${week_ago}. 14 days ago: ${prev_week}. 30 days ago: ${thirty_ago}. Month start: ${month_start}.

Run the full daily LinkedIn ad analysis for Spectatr.ai.

STEP 1 — call linkedin_get_campaigns FIRST and wait for the result.
  Collect the numeric id of every returned campaign — used to match analytics rows to names.

STEP 2 — call all six in parallel after STEP 1 completes:
  a. linkedin_get_analytics(startDate=${week_ago}, endDate=${yest}, granularity=DAILY)
     → 7-day window (complete days only); one row per campaign per day — SUM for totals
  b. linkedin_get_analytics(startDate=${prev_week}, endDate=${week_ago}, granularity=ALL)
     → prior 7-day window; one aggregated row per campaign — use as WoW baseline
  c. linkedin_get_analytics(startDate=${thirty_ago}, endDate=${yest}, granularity=ALL)
     → last 30 days; one aggregated row per campaign — save as kpis30d / camps30d
  d. linkedin_get_analytics(startDate=${month_start}, endDate=${yest}, granularity=ALL)
     → month-to-date; one aggregated row per campaign — save as kpisMtd / campsMtd
  e. linkedin_get_creatives
  f. linkedin_get_posts
     → Fetches last 20 organic posts from the LinkedIn org page with engagement stats

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

ORGANIC POSTS (from STEP 2f linkedin_get_posts result):
- linkedin_get_posts already saves posts.json automatically — no further action needed for post data.
- Call save_posts() as a no-op checkpoint to confirm organic data step is complete.

STEP 4 — save_metrics, save_suggestions, save_copy_variants, save_new_audiences, save_posts, save_report

All 6 save_ calls are required. Use exact API numbers. Never round or estimate metrics.

STEP 5 — call BOTH in parallel:
  a. fetch_sports_news — returns up to 25 articles from 11 sports/broadcast/OTT RSS feeds
  b. read_post_history — returns which proof points, products, formats, and opening patterns were used in the last 14 days

STEP 5b — CURATE & SCRAPE:
  Review all 25 articles. Score each for relevance to these topics:
    - Sports technology / AI in sports
    - Broadcast innovation / production workflows
    - OTT / streaming / digital distribution
    - League/federation digital transformation
    - Fan engagement / content strategy
    - Rights distribution / media value
  Select the top 8 most relevant articles.
  Then call scrape_article with the URLs of your top 5 selected articles.
  Use the returned full article text to deeply understand the story — key quotes, specific data points, named organizations, and operational implications.

STEP 5c — PLAN before writing. For each of 5 posts, define this frame FIRST:
  - Reader situation: Their operational reality, challenge, or fear
  - Uncomfortable truth: Why their current approach is insufficient
  - Inflection point: Why now? What's changed? (tied to the news article)
  - Resolution: How Spectatr removes the friction (product posts only)
  - Closing tension: A specific question that forces self-evaluation

STEP 6 — Generate exactly 5 LinkedIn post drafts.

INPUTS:
  (a) Full article content from STEP 5b — use specific quotes, data points, and named organizations
  (b) Post history from STEP 5 — AVOID repeating overused stats and patterns (see rotation rules below)
  (c) Top 3 best-performing past posts from linkedin_get_posts, sorted by engagement rate
      = (likes + comments + shares) / max(impressions, 1) × 100 — study their structure, tone, and what made them work
  (d) Full brand context in the system prompt

POST MIX:
  POST 1 — type: "product" — PULSE, AXIS, or JORDY AI (rotate: pick the LEAST featured product from post_history)
  POST 2 — type: "product" — different product from POST 1
  POST 3 — type: "news" — sports tech / broadcast trend, strong POV, Spectatr mention optional
  POST 4 — type: "news" — league / federation / rights perspective, different angle from POST 3
  POST 5 — type: "news" — contrarian take or industry diagnosis, Spectatr mention optional

PROOF POINT ROTATION (critical — prevents repetitive posts):
  - Check the post_history recentStats for stats used in the last 14 days
  - Do NOT repeat a stat that was used 3+ times in the last 14 days
  - If a stat was used last run, use a DIFFERENT angle on it (e.g. "9,500+ clips" framed as "speed" last time → frame as "scale without staff" or "global coverage" this time)
  - Prefer stats that have count=0 or were last used 7+ days ago
  - You have 4 case studies and ~18 individual stats — rotate through them, don't fixate on the same 3

OPENING PATTERNS (enforce diversity across the 5 posts):
  - At least 2 of 5 posts MUST open with a reader scenario: "It's [timeframe]. Your [role] just [situation]..."
  - At most 1 post may open with a news headline
  - At most 1 post may open with a statistic
  - No two posts may use the same opening device
  - Check post_history recentOpenings — if "scenario" openings are rare, use more; if "statement" is overused, avoid it

DIAGNOSTIC FRAMING (not descriptive — this is the single most important quality rule):
  - BAD: "PULSE delivered 9,500 clips in 7 weeks" (describing what happened — anyone could write this)
  - GOOD: "Manual clipping is a self-imposed restriction. Your competitor removed it." (diagnosing a problem)
  - Every post MUST name an uncomfortable truth about the reader's current workflow or industry
  - Sound like a VP thinking out loud, not a content engine producing copy

CLOSING QUESTIONS (friction, not fluff):
  - BAD: "What do you think?" / "How is your team approaching this?"
  - GOOD: "Is your broadcast infrastructure built for 2026 or still optimized for 2018?"
  - At least 3 of 5 posts must end with a question that forces a choice or confrontation
  - The question must be specific enough that a Head of Content or VP of Digital feels compelled to respond

SPECIFICITY MANDATE:
  - Every post MUST contain at least one specific data point, named organization, or direct quote from the source article
  - Posts that could have been written without reading the article are FAILURES
  - Use the scraped full article text — don't just reference the headline

LENGTH: 150-250 words per post. Front-load the hook in the first 2 lines (visible before LinkedIn's "see more" fold).

HARD RULES:
  - All 5 MUST use different format_types (THE PROVOCATION / THE DATA REFRAME / THE MATCHDAY SCENARIO / THE INDUSTRY DIAGNOSIS / THE NUMBERS POST)
  - All 5 MUST reference different news articles
  - All 5 must feel like different humans wrote them — different emotional registers
  - NEVER reference FLUX or BRAND GAUGE
  - NEVER fabricate or alter verified client numbers
  - NEVER start two posts with the same structural pattern

For each post, also provide a creative object for the dashboard mockup:
  background: CSS linear-gradient or solid hex that fits the mood (e.g. "linear-gradient(135deg,#0A66C2,#004182)")
  headline: ≤8 word bold image statement
  subtext: ≤12 word supporting line
  stat: the single most compelling number in the post (e.g. "9,500+ clips", "51.8M views")
  emoji: one emoji that captures the post theme

Then call save_generated_posts({ posts: [ ...all 5 post objects... ] }).
Pass the posts array directly — do NOT stringify it.`;

  let iter = 0;
  let response = await chat.sendMessage(userPrompt);

  while (iter < 30) {
    iter++;
    const candidate = response.response.candidates?.[0];
    if (!candidate?.content?.parts) {
      console.warn(`  ⚠️  Empty candidate on turn ${iter}, retrying...`);
      response = await chat.sendMessage("Continue where you left off. Complete all remaining steps.");
      continue;
    }

    // Extract function calls from the response
    const functionCalls: FunctionCallPart[] = [];
    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        functionCalls.push(part as FunctionCallPart);
      }
    }

    if (functionCalls.length === 0) break; // No more tool calls, we're done

    console.log(`\n[Turn ${iter}] ${functionCalls.map((c) => c.functionCall.name).join(", ")}`);

    // Execute all function calls and build responses
    const functionResponses: Part[] = [];
    for (const fc of functionCalls) {
      const resultStr = await executeTool(
        fc.functionCall.name,
        (fc.functionCall.args as Record<string, unknown>) || {}
      );
      let resultObj: any;
      try {
        const parsed = JSON.parse(resultStr);
        // Gemini requires response to be an object, not an array
        resultObj = Array.isArray(parsed) ? { data: parsed } : (typeof parsed === "object" && parsed !== null ? parsed : { result: parsed });
      } catch {
        resultObj = { result: resultStr };
      }
      functionResponses.push({
        functionResponse: {
          name: fc.functionCall.name,
          response: resultObj,
        },
      } as FunctionResponsePart);
    }

    response = await chat.sendMessage(functionResponses);
  }

  // Extract final text
  const finalText = response.response.candidates?.[0]?.content.parts
    .filter((p) => p.text)
    .map((p) => p.text)
    .join("\n")
    .slice(0, 600) || "";

  console.log(`\n${"─".repeat(52)}`);
  console.log(`  ✅ Done in ${iter} turns`);
  console.log(`${"─".repeat(52)}\n`);

  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const dashUrl = owner
    ? `https://${owner}.github.io/spectatr-linkedin-agent/`
    : "your GitHub Pages dashboard";

  await postSlack(
    `*Spectatr.ai LinkedIn Report — ${today}*\n\n${finalText}\n\n_Dashboard: ${dashUrl}_`
  );
}

run().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
