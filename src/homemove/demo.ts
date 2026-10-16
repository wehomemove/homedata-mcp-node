import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { homemoveWidgetHtml } from "./widget.js";

/**
 * mcp.homemove.com/demo/: the app shown the way ChatGPT shows it. The page sends the
 * same tools/call ChatGPT sends to /mcp, so every price is live, and renders the real
 * card in a frame whose window.openai stand-in forwards callTool to /mcp and asks the
 * page for fullscreen. Nothing here is a mock-up of a price.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "demo");
const FILES: Record<string, [string, string]> = {
  "/demo/": ["index.html", "text/html; charset=utf-8"],
  "/demo/demo.css": ["demo.css", "text/css; charset=utf-8"],
  "/demo/demo.js": ["demo.js", "text/javascript; charset=utf-8"],
  "/demo/logo.png": ["logo.png", "image/png"],
  "/demo/icon.png": ["icon.png", "image/png"],
};

const SHIM = `<script>
window.openai = {
  toolOutput: null, displayMode: "inline",
  async callTool(name, args) {
    const res = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }) });
    const body = await res.json();
    return { structuredContent: body.result && body.result.structuredContent, content: body.result && body.result.content };
  },
  async requestDisplayMode({ mode }) { window.openai.displayMode = mode; parent.postMessage({ type: "display", mode }, "*"); return { mode }; },
  async openExternal({ href }) { window.open(href, "_blank", "noopener"); },
  async sendFollowUpMessage() {},
};
window.addEventListener("message", (e) => {
  if (e.source !== parent || !e.data || e.data.type !== "output") return;
  window.openai.toolOutput = e.data.data;
  window.dispatchEvent(new Event("openai:set_globals"));
});
parent.postMessage({ type: "output" }, "*");
</script>`;

export function demoAsset(path: string, origin: string): { body: Buffer; contentType: string } | undefined {
  if (path === "/demo/frame") {
    const html = homemoveWidgetHtml(origin).replace("<div id=\"app\"", `${SHIM}<div id="app"`);
    return { body: Buffer.from(html), contentType: "text/html; charset=utf-8" };
  }
  const file = FILES[path];
  if (!file) return undefined;
  let body = readFileSync(join(ROOT, file[0]));
  // The page names its CSS and script by content, so a deploy is never hidden behind a cached copy.
  if (path === "/demo/") {
    const v = (name: string) => createHash("sha256").update(readFileSync(join(ROOT, name))).digest("hex").slice(0, 12);
    body = Buffer.from(body.toString().replace("/demo/demo.css", `/demo/demo.css?v=${v("demo.css")}`).replace("/demo/demo.js", `/demo/demo.js?v=${v("demo.js")}`));
  }
  return { body, contentType: file[1] };
}
