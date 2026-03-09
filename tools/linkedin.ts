const BASE = "https://api.linkedin.com/v2";

export interface DateRange {
  start: string;
  end: string;
}

export class LinkedInClient {
  private headers: Record<string, string>;
  private accountId: string;
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private accessToken: string;

  constructor() {
    const token = process.env.LI_ACCESS_TOKEN;
    const accountId = process.env.LI_ACCOUNT_ID;
    const clientId = process.env.LI_CLIENT_ID;
    const clientSecret = process.env.LI_CLIENT_SECRET;
    const refreshToken = process.env.LI_REFRESH_TOKEN;

    if (!token) throw new Error("LI_ACCESS_TOKEN not set");
    if (!accountId) throw new Error("LI_ACCOUNT_ID not set");
    if (!clientId) throw new Error("LI_CLIENT_ID not set");
    if (!clientSecret) throw new Error("LI_CLIENT_SECRET not set");
    if (!refreshToken) throw new Error("LI_REFRESH_TOKEN not set");

    this.accountId = accountId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.accessToken = token;
    // NOTE: X-Restli-Protocol-Version: 2.0.0 breaks bracket-notation query params
    // on LinkedIn's v2 Marketing API — omit it to use REST.li 1.0 defaults.
    this.headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  private async refreshAccessToken(): Promise<void> {
    console.log("  🔄 Refreshing LinkedIn access token...");
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(`Token refresh failed: ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string };
    this.accessToken = data.access_token;
    this.headers["Authorization"] = `Bearer ${this.accessToken}`;
    console.log("  ✅ Token refreshed successfully");
  }

  private async get(path: string, retried = false): Promise<unknown> {
    const res = await fetch(`${BASE}${path}`, { headers: this.headers });
    if (res.status === 401 && !retried) {
      await this.refreshAccessToken();
      return this.get(path, true);
    }
    if (!res.ok) {
      throw new Error(`LinkedIn ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  async getCampaigns(status = "ACTIVE"): Promise<unknown> {
    const a = encodeURIComponent(this.accountId);
    return this.get(
      `/adCampaignsV2?q=search&search.account.values[0]=${a}` +
      `&search.status.values[0]=${status}` +
      `&fields=id,name,status,type,dailyBudget,totalBudget,costType,objectiveType`
    );
  }

  async getAnalytics(
    range: DateRange,
    granularity = "ALL",
    campaignUrns?: string[]
  ): Promise<unknown> {
    const [sy, sm, sd] = range.start.split("-").map(Number);
    const [ey, em, ed] = range.end.split("-").map(Number);
    const a = encodeURIComponent(this.accountId);

    // Build URL as a plain string to preserve bracket-notation for REST.li 1.0.
    // URLSearchParams encodes [ and ] in *keys*, breaking LinkedIn's query parser.
    let base =
      `/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&granularity=${granularity}` +
      `&dateRange.start.year=${sy}&dateRange.start.month=${sm}&dateRange.start.day=${sd}` +
      `&dateRange.end.year=${ey}&dateRange.end.month=${em}&dateRange.end.day=${ed}` +
      `&accounts[0]=${a}`;

    // Pin to exact campaign URNs from getCampaigns — prevents pulling in
    // data from any other account or campaign the token can see.
    if (campaignUrns && campaignUrns.length > 0) {
      base += campaignUrns
        .map((urn, i) => `&campaigns[${i}]=${encodeURIComponent(urn)}`)
        .join("");
    }

    // clickThroughRate is NOT requested — it requires additional scope and
    // the agent derives CTR = (clicks / impressions) × 100 from the raw counts.
    // Try with oneClickLeads (Lead Gen Form submissions).
    // Falls back to externalWebsiteConversions if the field is access-denied.
    const withLeads =
      "dateRange,pivotValues,impressions,clicks,costInLocalCurrency," +
      "approximateUniqueImpressions,externalWebsiteConversions,oneClickLeads";
    const withoutLeads =
      "dateRange,pivotValues,impressions,clicks,costInLocalCurrency," +
      "approximateUniqueImpressions,externalWebsiteConversions";

    try {
      return await this.get(`${base}&fields=${withLeads}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("403") || msg.includes("ACCESS_DENIED") || msg.includes("ILLEGAL_ARGUMENT")) {
        console.log("  ⚠️  oneClickLeads blocked — retrying without it");
        return await this.get(`${base}&fields=${withoutLeads}`);
      }
      throw err;
    }
  }

  async getCreatives(): Promise<unknown> {
    const a = encodeURIComponent(this.accountId);
    return this.get(
      `/adCreativesV2?q=search&search.account.values[0]=${a}&fields=id,status,type,content`
    );
  }
}
