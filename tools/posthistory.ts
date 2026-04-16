import * as fs from "fs";
import * as path from "path";

interface GeneratedPost {
  type?: string;
  format_type?: string;
  text?: string;
  product?: string;
  newsHeadline?: string;
  newsSource?: string;
}

interface DayEntry {
  date: string;
  posts: GeneratedPost[];
}

// Known proof points — detect when these stats appear in post text
const PROOF_POINTS = [
  { stat: "9,500+ clips", aliases: ["9,500", "9500"] },
  { stat: "10.6M+ views", aliases: ["10.6M", "10.6 million"] },
  { stat: "9x engagement", aliases: ["9x", "9× engagement", "170,154 likes"] },
  { stat: "500% FB surge", aliases: ["500%", "500 percent"] },
  { stat: "308% YouTube", aliases: ["308%"] },
  { stat: "51.8M views", aliases: ["51.8M", "51.8 million"] },
  { stat: "37K+ moments", aliases: ["37,000", "37K"] },
  { stat: "2x IG growth", aliases: ["2x Instagram", "2× Instagram", "2x follower"] },
  { stat: "110K+ likes", aliases: ["110,000", "110K"] },
  { stat: "50,000+ clips (ISG)", aliases: ["50,000+ clips", "50,000 clips"] },
  { stat: "512 daily highlights", aliases: ["512 daily", "512 NOC"] },
  { stat: "7.5M+ views (ISG)", aliases: ["7.5M", "7.5 million"] },
  { stat: "250+ hours saved", aliases: ["250+ hours", "250 hours"] },
  { stat: "3x uploads", aliases: ["5 → 15", "5→15", "3× increase"] },
  { stat: "+105% views (TTE)", aliases: ["+105%", "105%", "4K → 45K", "4K→45K"] },
  { stat: "30% retention (Jordy)", aliases: ["30% boost", "30% retention"] },
  { stat: "140% time spent (Jordy)", aliases: ["140% increase", "140% time"] },
  { stat: "+60% content exposure", aliases: ["+60%", "60% new content"] },
];

function detectProofPoints(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const pp of PROOF_POINTS) {
    for (const alias of pp.aliases) {
      if (lower.includes(alias.toLowerCase())) {
        found.push(pp.stat);
        break;
      }
    }
  }
  return found;
}

function classifyOpening(text: string): string {
  const firstLine = text.split("\n")[0].trim().toLowerCase();
  if (firstLine.startsWith("it's ") || firstLine.includes("your ") && firstLine.includes("just "))
    return "scenario";
  if (/^\d|^\+|^[\$£€₹]/.test(firstLine) || /\d+[%xX×]/.test(firstLine))
    return "statistic";
  if (firstLine.endsWith("?"))
    return "question";
  return "statement";
}

export function analyzePostHistory(days: number = 14): {
  recentStats: { stat: string; count: number; lastUsed: string }[];
  recentProducts: { product: string; count: number; lastUsed: string }[];
  recentFormats: { format: string; count: number; lastUsed: string }[];
  recentOpenings: { type: string; count: number }[];
  totalPostsAnalyzed: number;
} {
  const filePath = path.join(__dirname, "../dashboard/data/generated_posts.json");
  let entries: DayEntry[] = [];
  try {
    entries = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return { recentStats: [], recentProducts: [], recentFormats: [], recentOpenings: [], totalPostsAnalyzed: 0 };
  }

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().split("T")[0];
  const recent = entries.filter((e) => e.date >= cutoff);

  const statMap: Record<string, { count: number; lastUsed: string }> = {};
  const productMap: Record<string, { count: number; lastUsed: string }> = {};
  const formatMap: Record<string, { count: number; lastUsed: string }> = {};
  const openingMap: Record<string, number> = {};
  let total = 0;

  for (const entry of recent) {
    for (const post of entry.posts || []) {
      total++;
      const text = post.text || "";

      // Track proof points
      for (const stat of detectProofPoints(text)) {
        if (!statMap[stat]) statMap[stat] = { count: 0, lastUsed: "" };
        statMap[stat].count++;
        if (entry.date > statMap[stat].lastUsed) statMap[stat].lastUsed = entry.date;
      }

      // Track products
      const prod = post.product || "";
      if (prod) {
        if (!productMap[prod]) productMap[prod] = { count: 0, lastUsed: "" };
        productMap[prod].count++;
        if (entry.date > productMap[prod].lastUsed) productMap[prod].lastUsed = entry.date;
      }

      // Track format types
      const fmt = post.format_type || "";
      if (fmt) {
        if (!formatMap[fmt]) formatMap[fmt] = { count: 0, lastUsed: "" };
        formatMap[fmt].count++;
        if (entry.date > formatMap[fmt].lastUsed) formatMap[fmt].lastUsed = entry.date;
      }

      // Track opening patterns
      const opening = classifyOpening(text);
      openingMap[opening] = (openingMap[opening] || 0) + 1;
    }
  }

  return {
    recentStats: Object.entries(statMap)
      .map(([stat, v]) => ({ stat, ...v }))
      .sort((a, b) => b.count - a.count),
    recentProducts: Object.entries(productMap)
      .map(([product, v]) => ({ product, ...v }))
      .sort((a, b) => b.count - a.count),
    recentFormats: Object.entries(formatMap)
      .map(([format, v]) => ({ format, ...v }))
      .sort((a, b) => b.count - a.count),
    recentOpenings: Object.entries(openingMap)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    totalPostsAnalyzed: total,
  };
}
