/**
 * Every link the app hands to homemove.com says where the visitor came from, so a lead,
 * a booking or a click can be traced to the ChatGPT app. Only homemove.com links are
 * tagged, and UTMs already on a link are kept.
 */
export const UTM = { utm_source: "chatgpt-plugin", utm_medium: "referral", utm_campaign: "homemove-chatgpt-app" } as const;

export function tagged(url: string, content?: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (!/(^|\.)homemove\.com$/.test(u.hostname) || u.searchParams.has("utm_source")) return url;
  for (const [k, v] of Object.entries(UTM)) u.searchParams.set(k, v);
  if (content) u.searchParams.set("utm_content", content.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40));
  return u.toString();
}
