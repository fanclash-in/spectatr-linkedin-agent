import { FunctionDeclaration, SchemaType } from "@google/generative-ai";

// Helper to convert JSON Schema types to Gemini SchemaType
function convertSchema(schema: any): any {
  if (!schema) return undefined;
  const result: any = {};

  if (schema.type === "object") {
    result.type = SchemaType.OBJECT;
    if (schema.properties) {
      result.properties = {};
      for (const [key, val] of Object.entries(schema.properties)) {
        result.properties[key] = convertSchema(val);
      }
    }
    if (schema.required) result.required = schema.required;
    if (schema.description) result.description = schema.description;
  } else if (schema.type === "array") {
    result.type = SchemaType.ARRAY;
    if (schema.items) result.items = convertSchema(schema.items);
    if (schema.description) result.description = schema.description;
  } else if (schema.type === "string") {
    result.type = SchemaType.STRING;
    if (schema.description) result.description = schema.description;
    if (schema.enum) result.enum = schema.enum;
  } else if (schema.type === "number" || schema.type === "integer") {
    result.type = SchemaType.NUMBER;
    if (schema.description) result.description = schema.description;
  } else if (schema.type === "boolean") {
    result.type = SchemaType.BOOLEAN;
    if (schema.description) result.description = schema.description;
  }

  return result;
}

const TOOL_DEFS = [
  {
    name: "linkedin_get_campaigns",
    description: "Fetch all active LinkedIn ad campaigns",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "linkedin_get_analytics",
    description: "Fetch campaign analytics for the given date range. DAILY returns one row per campaign per day (SUM across days for period totals). ALL returns one aggregated row per campaign for the entire range. Match pivotValues[0] campaign IDs against linkedin_get_campaigns to scope to this account.",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD (inclusive)" },
        endDate: { type: "string", description: "YYYY-MM-DD (inclusive)" },
        granularity: {
          type: "string",
          enum: ["DAILY", "ALL"],
          description: "DAILY = one row per campaign per day. ALL = one aggregated row per campaign for the date range.",
        },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "linkedin_get_posts",
    description: "Fetch recent organic posts from the LinkedIn organization page along with engagement metrics (likes, comments, shares, impressions, clicks). Returns up to 20 most recent posts. Requires LI_ORG_ID in .env and r_organization_social OAuth scope.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "save_posts",
    description: "Save organic LinkedIn post performance data to posts.json for the dashboard Content tab.",
    parameters: {
      type: "object",
      properties: {
        posts: {
          type: "array",
          description: "Array of post objects. Each must have: id, date (YYYY-MM-DD), text, likes, comments, shares, impressions, clicks, url.",
          items: { type: "object" },
        },
      },
      required: ["posts"],
    },
  },
  {
    name: "linkedin_get_creatives",
    description: "Fetch ad creative details (copy, headline, CTA)",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_history",
    description: "Read rolling N-day performance history",
    parameters: {
      type: "object",
      properties: { days: { type: "number" } },
      required: ["days"],
    },
  },
  {
    name: "save_metrics",
    description: "Save today's metrics to the dashboard",
    parameters: {
      type: "object",
      properties: {
        kpis: { type: "object", description: "{ totalSpend, avgCtr, totalLeads, avgCpl, impressions, spendDelta, ctrDelta, leadsDelta, cplDelta, imprDelta }" },
        campaigns: { type: "array", description: "[{ name, st:'a'|'w'|'p', spend, ctr, ctrD, cpl, cplD, leads, freq }]", items: { type: "object" } },
        trendData: { type: "object", description: "{ labels:string[], ctrValues:number[], cplValues:number[] }" },
        spendByCampaign: { type: "object", description: "{ labels:string[], values:number[] }" },
        alerts: { type: "array", description: "[{ t:'r'|'a'|'g', title, meta }]", items: { type: "object" } },
        opportunities: { type: "array", description: "[{ t:'g'|'a', title, meta }]", items: { type: "object" } },
        kpis30d: { type: "object", description: "KPIs for last 30 days (same shape as kpis, delta fields = null)" },
        camps30d: { type: "array", description: "Per-campaign metrics for last 30 days (same shape as campaigns, delta fields = null)", items: { type: "object" } },
        kpisMtd: { type: "object", description: "KPIs for current month-to-date (same shape as kpis, delta fields = null)" },
        campsMtd: { type: "array", description: "Per-campaign metrics for current month-to-date (same shape as campaigns, delta fields = null)", items: { type: "object" } },
      },
      required: ["kpis", "campaigns", "alerts", "opportunities", "kpis30d", "camps30d", "kpisMtd", "campsMtd"],
    },
  },
  {
    name: "save_suggestions",
    description: "Save today's AI suggestions",
    parameters: {
      type: "object",
      properties: {
        suggestions: { type: "array", description: "[{ type:'c'|'cp'|'b'|'t', priority:'HIGH'|'MEDIUM'|'LOW', title, detail, meta }]", items: { type: "object" } },
      },
      required: ["suggestions"],
    },
  },
  {
    name: "save_copy_variants",
    description: "Save new ad copy variants for underperforming ads",
    parameters: {
      type: "object",
      properties: {
        variants: { type: "array", description: "[{ adName, campaign, product, diagnosis, format, cta, headlines:[{label,text}], bodies:[{label,text}] }]", items: { type: "object" } },
      },
      required: ["variants"],
    },
  },
  {
    name: "save_new_audiences",
    description: "Save new LinkedIn audience segment recommendations",
    parameters: {
      type: "object",
      properties: {
        audiences: { type: "array", description: "[{ name, angle, why, product, titles[], industries[], size, geo, headline, body, cta, reason }]", items: { type: "object" } },
      },
      required: ["audiences"],
    },
  },
  {
    name: "save_report",
    description: "Save full markdown report to reports/YYYY-MM-DD.md",
    parameters: {
      type: "object",
      properties: { markdown: { type: "string" } },
      required: ["markdown"],
    },
  },
  {
    name: "fetch_sports_news",
    description: "Fetch top recent sports industry news from 11 RSS feeds covering sports business, broadcast tech, OTT, and streaming. Returns up to 25 articles sorted by most recent.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "scrape_article",
    description: "Fetch and extract main text content from article URLs. Returns up to 2000 chars of body text per article. Use this to get full article substance for post generation.",
    parameters: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "Array of up to 5 article URLs to scrape for full text" },
      },
      required: ["urls"],
    },
  },
  {
    name: "read_post_history",
    description: "Analyze the last 14 days of generated LinkedIn posts. Returns which proof points, products, format types, and opening patterns were used recently. Use this to avoid repetition.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "save_generated_posts",
    description: "Save 5 AI-generated LinkedIn post drafts for today to generated_posts.json. Each post includes full copy, creative brief, and news source.",
    parameters: {
      type: "object",
      properties: {
        posts: {
          type: "array",
          description: "Array of exactly 5 post objects",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["product", "news"], description: "'product' for product-focused post, 'news' for news/trend post" },
              format_type: { type: "string", description: "One of: THE PROVOCATION, THE DATA REFRAME, THE MATCHDAY SCENARIO, THE INDUSTRY DIAGNOSIS, THE NUMBERS POST" },
              text: { type: "string", description: "Full LinkedIn post copy including hashtags" },
              newsHeadline: { type: "string", description: "Headline of the source news article" },
              newsUrl: { type: "string", description: "URL of the source news article" },
              newsSource: { type: "string", description: "Publication name e.g. SportsPro" },
              product: { type: "string", description: "PULSE, AXIS, JORDY AI, or empty string" },
              creative: {
                type: "object",
                description: "Visual brief for the Canva-style mockup card",
                properties: {
                  background: { type: "string", description: "CSS linear-gradient or hex color for card background" },
                  headline: { type: "string", description: "Bold image headline, max 8 words" },
                  subtext: { type: "string", description: "Supporting line, max 12 words" },
                  stat: { type: "string", description: "Most compelling number e.g. '9,500+ clips'" },
                  emoji: { type: "string", description: "Single emoji capturing the post theme" },
                },
              },
            },
          },
        },
      },
      required: ["posts"],
    },
  },
];

// Convert to Gemini FunctionDeclaration format
export const TOOLS: FunctionDeclaration[] = TOOL_DEFS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: convertSchema(t.parameters),
}));
