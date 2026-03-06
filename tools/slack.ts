export async function postSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    console.log("  📣 Slack notified");
  } catch (e) {
    console.warn("  ⚠️ Slack failed:", e);
  }
}
