// Homemove in ChatGPT, demonstrated: each scenario sends the same tools/call ChatGPT would send to
// this endpoint's /mcp, then shows the real Homemove card with the result. Prices are live.
(() => {
  const SCENARIOS = [
    { id: "level2", label: "Level 2 survey", prompt: "How much is a Level 2 survey?",
      tool: "homemove_quote", args: { service: "Level 2 survey" } },
    { id: "survey", label: "Survey", prompt: "How much is a Level 3 building survey for a £450,000 house in Bath, BA1 1LN?",
      tool: "homemove_quote", args: { service: "Level 3 survey", postcode: "BA1 1LN", property_price: 450000 } },
    { id: "move", label: "My whole move", prompt: "I'm selling my 2-bed in Manchester (M1 1AE) and buying in London (SW1A 2AA) for £350,000 with a mortgage. What will my move cost?",
      tool: "homemove_move_plan", args: { situation: "buying_and_selling", from_postcode: "M1 1AE", to_postcode: "SW1A 2AA", to_address: "10 Downing Street", property_price: 350000, sale_price: 250000, mortgage: true, bedrooms: 2 } },
    { id: "clean", label: "Moving-out clean", prompt: "What would an end of tenancy clean cost for my two-bed flat in Leeds, LS1 4AP?",
      tool: "homemove_quote", args: { service: "end of tenancy clean", postcode: "LS1 4AP", bedrooms: 2 } },
    { id: "legal", label: "Conveyancing", prompt: "What would conveyancing cost for buying a £275,000 leasehold flat in Manchester, M1 1AE, with a mortgage?",
      tool: "homemove_quote", args: { service: "conveyancing", postcode: "M1 1AE", property_price: 275000, answers: { transaction: "Buying", tenure: "Leasehold", funding_type: "Mortgage" } } },
    { id: "snag", label: "Snagging survey", prompt: "I'm buying a 3-bed new build in Manchester, M1 1AE. How much is a snagging survey?",
      tool: "homemove_quote", args: { service: "snagging survey", postcode: "M1 1AE", bedrooms: 3 } },
    { id: "removals", label: "Removals", prompt: "How much would removals cost from London SW1A 2AA to Leeds LS1 4AP?",
      tool: "homemove_quote", args: { service: "removals", postcode: "SW1A 2AA", to_postcode: "LS1 4AP" } },
    { id: "landlord", label: "Landlord certificates", prompt: "I'm letting out a flat in Bristol, BS1 4DJ. What would the landlord certificates cost?",
      tool: "homemove_move_plan", args: { situation: "landlord", to_postcode: "BS1 4DJ" } },
  ];
  const REPLY = {
    priced: (d) => `Homemove's price is £${Number(d.price_gbp).toLocaleString("en-GB")}${d.indicative ? `, indicative for ${d.indicative}` : ""}. It's confirmed when you book, and the card can take you straight to homemove.com.`,
    needs_answers: (d) => d.from_gbp ? `A ${d.product.name} with Homemove is from £${Number(d.from_gbp).toLocaleString("en-GB")}, depending on the home's value. Pick your address on the card for your exact price.` : "I can price that. I just need a couple of details: answer here, or tap Get my price on the card.",
    quoted_by_hand: () => "That one is priced by the Homemove team rather than instantly. The card links you to them.",
    plan: (d) => `Here's your move, step by step: £${Number(d.total_gbp).toLocaleString("en-GB")} for the ${d.priced} steps priced so far${d.stamp_duty ? `, with stamp duty of £${Number(d.stamp_duty.total_tax).toLocaleString("en-GB")} to HMRC shown separately` : ""}. Tap Price it on anything still to price.`,
  };
  const $ = (s) => document.querySelector(s);
  const h = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; };
  const chat = $(".chat"), chips = $(".chips");
  let running = 0;

  async function call(tool, args) {
    const res = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } }) });
    const body = await res.json();
    return body.result?.structuredContent ?? {};
  }

  async function run(s) {
    const mine = ++running;
    chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === s.id)));
    chat.replaceChildren(h("div", "msg user", s.prompt));
    const bot = h("div", "msg bot");
    const who = h("div", "who"); const icon = h("img"); icon.src = "/demo/icon.png"; icon.alt = ""; who.append(icon, document.createTextNode("Homemove"));
    const tool = h("div", "tool", `Called ${s.tool}`);
    const typing = h("div", "typing"); typing.append(h("i"), h("i"), h("i"));
    bot.append(who, tool, typing);
    chat.append(bot);
    const data = await call(s.tool, s.args).catch(() => ({}));
    if (mine !== running) return;
    typing.remove();
    const frame = h("iframe", "frame");
    frame.title = "Homemove card";
    frame.dataset.output = JSON.stringify(data);
    frame.src = "/demo/frame";
    bot.append(frame, h("div", "reply", (data.view === "plan" ? REPLY.plan : REPLY[data.status] ?? REPLY.needs_answers)(data)));
  }

  // The card asks for fullscreen the way it asks ChatGPT; the frame tells us its height.
  window.addEventListener("message", (e) => {
    const frame = [...document.querySelectorAll("iframe.frame")].find((f) => f.contentWindow === e.source);
    if (!frame || typeof e.data !== "object") return;
    if (e.data.type === "display") frame.classList.toggle("full", e.data.mode === "fullscreen");
    if (e.data.type === "output") frame.contentWindow.postMessage({ type: "output", data: JSON.parse(frame.dataset.output || "{}") }, "*");
  });

  SCENARIOS.forEach((s) => { const b = h("button", "", s.label); b.dataset.id = s.id; b.onclick = () => run(s); chips.append(b); });
  const start = SCENARIOS.find((s) => s.id === new URLSearchParams(location.search).get("s")) ?? SCENARIOS[0];
  run(start);
})();
