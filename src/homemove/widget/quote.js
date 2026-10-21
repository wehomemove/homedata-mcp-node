// Homemove quote takeover for ChatGPT.
// Homies and their rig come from the iOS app (Resources/Homies, Data/homie-loops.json); springs,
// celebration choreography and confetti physics are ported from Theme.swift and Joy/*.swift so the
// web and the app move the same way. Everything degrades to still frames under reduced motion.
(() => {
  "use strict";
  const A = (document.getElementById("app")?.dataset.base ?? "") + "assets/";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
  const gbp = (n) => "£" + Math.round(n).toLocaleString("en-GB");

  // ---------------------------------------------------------------- springs
  // SwiftUI .spring(response:dampingFraction:) as WAAPI keyframes. Theme.swift: snappy, smooth, bouncy.
  const SPRINGS = { snappy: [0.28, 0.86], smooth: [0.42, 0.9], bouncy: [0.5, 0.68] };
  function springCurve(name) {
    const [response, zeta] = SPRINGS[name];
    const w0 = (2 * Math.PI) / response, wd = w0 * Math.sqrt(1 - zeta * zeta);
    const x = (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    const dur = Math.log(1000) / (zeta * w0);
    const n = 48, pts = [];
    for (let i = 0; i <= n; i++) pts.push(x((dur * i) / n));
    pts[n] = 1;
    return { dur: dur * 1000, pts };
  }
  /** Animate el from `from` to `to` (objects of numbers) along a spring; style(v) builds the frame. */
  function spring(el, name, from, to, style, delay = 0) {
    if (reduced) { Object.assign(el.style, style(to)); return Promise.resolve(); }
    const { dur, pts } = springCurve(name);
    const frames = pts.map((p, i) => {
      const v = {}; for (const k in to) v[k] = from[k] + (to[k] - from[k]) * p;
      return { ...style(v), offset: i / (pts.length - 1) };
    });
    const anim = el.animate(frames, { duration: dur, delay, fill: "both", easing: "linear" });
    return anim.finished;
  }

  // ---------------------------------------------------------------- rig
  let RIG = null;
  const QUAD = "cubic-bezier(.455,.03,.515,.955)"; // ease-in-out quad, as HomieLoop.swift interpolates
  function rigFrames(steps, part) {
    const last = { scale: 1, scaleY: 1, rotate: 0, ty: 0 };
    const period = steps[steps.length - 1].t || 1;
    return (loopPeriod) => steps.map((s) => {
      Object.assign(last, Object.fromEntries(Object.entries(s).filter(([k]) => k !== "t")));
      const ty = (last.ty / part.frame.h) * 100;
      return {
        offset: Math.min(1, s.t / loopPeriod),
        transform: `translateY(${ty}%) rotate(${last.rotate}deg) scale(${last.scale}, ${last.scale * last.scaleY})`,
        easing: QUAD,
      };
    }).concat(period < loopPeriod ? [{ offset: 1, transform: `translateY(${(last.ty / part.frame.h) * 100}%) rotate(${last.rotate}deg) scale(${last.scale}, ${last.scale * last.scaleY})` }] : []);
  }
  /** A living Homie: base body, parts on their own loops (blinks, sparkles, seals), breathing from the feet. */
  function livingHomie(name) {
    const hero = RIG.heroes[name];
    const root = h("div", { class: "homie", style: `aspect-ratio:${hero.width}/${hero.height}` });
    const breath = h("div", { class: "breath" });
    breath.append(h("img", { class: "base", src: `${A}loops/${hero.base}.webp`, alt: "" }));
    const nodes = {};
    const place = (part) => {
      const parent = part.parent ? hero.parts.find((p) => p.id === part.parent) : null;
      const ox = parent ? parent.frame.x : 0, oy = parent ? parent.frame.y : 0;
      const pw = parent ? parent.frame.w : hero.width, ph = parent ? parent.frame.h : hero.height;
      const f = part.frame;
      const el = h("div", { class: "part", style: `left:${((f.x - ox) / pw) * 100}%;top:${((f.y - oy) / ph) * 100}%;width:${(f.w / pw) * 100}%;height:${(f.h / ph) * 100}%;transform-origin:${((part.anchor.x - f.x) / f.w) * 100}% ${((part.anchor.y - f.y) / f.h) * 100}%` });
      el.append(h("img", { src: `${A}loops/${part.image}.webp`, alt: "" }));
      nodes[part.id] = el;
      (parent ? nodes[parent.id] : breath).append(el);
      if (!reduced && part.loop) {
        const p = part.loop.period;
        el.animate(rigFrames(part.loop.steps, part)(p), { duration: p * 1000, iterations: Infinity, delay: -Math.random() * p * 1000 });
      }
    };
    // Parents before children.
    const pending = [...hero.parts];
    while (pending.length) {
      const i = pending.findIndex((p) => !p.parent || nodes[p.parent]);
      place(pending.splice(i < 0 ? 0 : i, 1)[0]);
    }
    if (!reduced) breath.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(1.02)" }, { transform: "scaleY(1)" }], { duration: 3600, iterations: Infinity, easing: "ease-in-out" });
    root.append(breath);
    return root;
  }
  /** The two-frame walk: hard swap a/b every 0.2s, -8px bob on b. */
  function walker() {
    const el = h("div", { class: "walker" }, h("img", { src: `${A}loops/loop-walk-a.webp`, alt: "" }), h("img", { src: `${A}loops/loop-walk-b.webp`, alt: "" }));
    if (!reduced) {
      el.children[1].animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 800, iterations: Infinity, easing: "steps(1, end)" });
      el.animate([{ translate: "0 0" }, { translate: "0 -8px" }, { translate: "0 0" }, { translate: "0 -8px" }, { translate: "0 0" }], { duration: 800, iterations: Infinity, easing: "ease-in-out" });
    }
    return el;
  }

  // ---------------------------------------------------------------- confetti (Joy/Confetti.swift)
  function confetti(canvas, seed = Date.now()) {
    if (reduced) return;
    const N = 80, LIFE = 2.4, DRAG = 2.4, G = 720;
    const TONES = ["#FF4353", "#E71963", "#1D2733", "#FBF8F4", "#F3EEE4"];
    let s = BigInt(seed) | 1n;
    const next = () => { s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn; return Number(s >> 11n) / 2 ** 53; };
    const pieces = Array.from({ length: N }, () => {
      const roll = next(), shape = roll < 0.6 ? "strip" : roll < 0.85 ? "square" : "dot";
      return {
        ox: 0.5 + (next() - 0.5) * 0.34, vx: (next() - 0.5) * 820, vy: -(420 + next() * 560), delay: next() * 0.14,
        w: shape === "strip" ? 5 + next() * 2 : 7 + next() * 2, h: shape === "strip" ? 10 + next() * 5 : 7 + next() * 2,
        spin: next() * Math.PI * 2, spinSpeed: (next() - 0.5) * 9, flutter: 3 + next() * 7, sway: 8 + next() * 18,
        swayPhase: next() * Math.PI * 2, tone: TONES[Math.floor(next() * 5)], shape,
      };
    });
    const dpr = devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    const start = performance.now();
    const frame = (now) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const e = (now - start) / 1000;
      if (e > LIFE) return;
      ctx.globalAlpha = e <= LIFE - 0.6 ? 1 : Math.max(0, 1 - (e - (LIFE - 0.6)) / 0.6);
      for (const p of pieces) {
        const t = Math.max(0, e - p.delay), decay = 1 - Math.exp(-DRAG * t);
        const x = p.ox * W + (p.vx * decay) / DRAG + p.sway * Math.sin(t * 2.6 + p.swayPhase) * Math.min(1, t * 1.5);
        const y = H * 0.55 + (p.vy * decay) / DRAG + (G / DRAG) * t - (G * decay) / (DRAG * DRAG);
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.spin + p.spinSpeed * t); ctx.scale(Math.max(0.15, Math.abs(Math.cos(t * p.flutter))), 1);
        ctx.fillStyle = p.tone;
        if (p.shape === "dot") { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- sky
  function sky() {
    const el = h("div", { class: "sky" });
    const c = h("canvas");
    el.append(c);
    [["cloud-1", 14, 120, 0.42], ["cloud-2", 48, 160, 0.3], ["cloud-3", 70, 140, 0.36]].forEach(([n, top, dur, w], i) =>
      el.append(h("img", { class: "cloud", src: `${A}sky/${n}-v1.webp`, alt: "", style: `top:${top}%;width:${w * 100}vw;max-width:520px;animation-duration:${dur}s;animation-delay:-${i * 47}s` })));
    // Stars: fixed field, a few twinkle. Night mode is the brand's dark mode (#091A2C, stars, white Homie).
    requestAnimationFrame(() => {
      const ctx = c.getContext("2d"), dpr = devicePixelRatio || 1;
      let stars = [];
      const draw = (now) => {
        const W = c.clientWidth, H = c.clientHeight;
        if (c.width !== W * dpr) {
          c.width = W * dpr; c.height = H * dpr;
          stars = Array.from({ length: Math.round((W * H) / 5200) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + 0.3, tw: Math.random() < 0.2, ph: Math.random() * 6, red: Math.random() < 0.18 }));
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
        for (const s of stars) {
          ctx.globalAlpha = s.tw && !reduced ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 900 + s.ph)) : 0.7;
          ctx.fillStyle = s.red ? "#FF4353" : "#1d2733"; ctx.globalAlpha *= 0.22; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 1.4, 0, 7); ctx.fill();
        }
        if (!reduced) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    });
    return el;
  }


  // ---------------------------------------------------------------- data
  // Everything shown comes from the homemove_quote tool result (window.openai.toolOutput).
  // Outside ChatGPT, ?demo=<status> shows a marked sample so the motion can be reviewed.
  const LOOK = {
    surveys: { homie: "survey", cheer: "survey-surveyor-cheer", hello: "Hello! I'm your surveyor." },
    cleaning: { homie: "cleaning", cheer: "joy-cheer", hello: "Sparkly! Let's price your clean." },
    removals: { homie: "removals", cheer: "removals-mover-cheer", hello: "Let's get you moving." },
    legal: { homie: "legal", cheer: "legal-lawyer-cheer", hello: "Let's sort the legal bit." },
  };
  const lookFor = (type) => LOOK[type] ?? { homie: "welcome", cheer: "hm-cheer", hello: "Hello! Let's price that." };
  const ICON = { transaction: "key", tenure: "document", funding_type: "money", beds: "bed", property_price: "home", snagging_type: "new-build", roof_type: "home", roof_survey_type: "home", asb_type: "secure", matrimonial_witness: "legal", thermographic_type: "energy", structural_survey_type: "measure" };
  const VALUE_STOPS = [100000, 150000, 200000, 250000, 300000, 400000, 500000, 600000, 750000, 1000000, 1500000, 2000000];

  const DEMO = {
    priced: { status: "priced", product: { id: 2, name: "Level 2 Survey", type: "surveys" }, price_gbp: 499, postcode: "SW1A 2AA", property: { address: "10 Downing Street, London", postcode: "SW1A 2AA" }, assumed: [{ name: "property_price", value: "£300k–£400k", source: "Homedata's estimate for this home" }], answers: [], band: { min: 300001, max: 400000 }, sample: true },
    needs_answers: { status: "needs_answers", product: { id: 1039, name: "Snagging Survey", type: "surveys" }, postcode: "M1 1AE", assumed: [], answers: [], questions: [
      { name: "beds", question: "How many bedrooms does the home have?", options: ["1 Bedroom", "2 Bedrooms", "3 Bedrooms", "4 Bedrooms", "5+ Bedrooms"] },
      { name: "snagging_type", question: "Is the snagging inspection before completion or after you've moved in?", options: ["Pre-inspection", "Post-Completion"] }], sample: true },
    clean: { status: "needs_answers", product: { id: 1097, name: "End of Tenancy Clean", type: "cleaning" }, postcode: "LS1 4AP", assumed: [], answers: [], questions: [
      { name: "beds", question: "How many bedrooms does the home have?", options: ["1 Bedroom", "2 Bedrooms", "3 Bedrooms", "4 Bedrooms", "5+ Bedrooms"] }], sample: true },
    value: { status: "needs_answers", product: { id: 2, name: "Level 2 Survey", type: "surveys" }, postcode: "", assumed: [], answers: [], from_gbp: 449, sample: true, questions: [
      { name: "property_price", question: "Roughly what is the home worth, or what are you paying for it?", options: [] }],
      bands: [{ min: 1, max: 200000, label: "up to £200k", price_gbp: 449 }, { min: 200001, max: 300000, label: "£200k–£300k", price_gbp: 499 }, { min: 300001, max: 500000, label: "£300k–£500k", price_gbp: 549 }, { min: 500001, max: 750000, label: "£500k–£750k", price_gbp: 649 }, { min: 750001, max: 1000000, label: "£750k–£1m", price_gbp: 749 }, { min: 1000001, max: 100000000, label: "over £1m", price_gbp: 899 }] },
  };
  DEMO.removals = { status: "needs_answers", product: { id: 1054, name: "Removals", type: "removals" }, postcode: "SW1A 2AA", assumed: [], answers: [], sample: true,
    questions: [{ name: "to_postcode", question: "What's the postcode you're moving to?", options: [] }, { name: "home_size", question: "How big is the home you're moving out of?", options: ["Studio", "1 bedroom", "2 bedrooms", "3 bedrooms", "4 bedrooms", "5+ bedrooms"] }],
    picker: [{"room": "Bedrooms", "items": [{"id": 1531, "name": "Single Bed & Mattress", "cubic_meters": 0.81}, {"id": 1238, "name": "Double Bed & Mattress", "cubic_meters": 1.4213}, {"id": 1365, "name": "Kingsize Bed & Mattress", "cubic_meters": 1.995}, {"id": 2010, "name": "Single Wardrobe", "cubic_meters": 0.5814}, {"id": 1844, "name": "Double Wardrobe", "cubic_meters": 1.242}, {"id": 1174, "name": "Chest Of Drawers", "cubic_meters": 0.5184}, {"id": 1109, "name": "Bedside Table", "cubic_meters": 0.0875}, {"id": 1848, "name": "Dressing Table", "cubic_meters": 0.7}, {"id": 2034, "name": "Television", "cubic_meters": 0.1376}, {"id": 1527, "name": "Side Table", "cubic_meters": 0.2871}]}, {"room": "Living", "items": [{"id": 1611, "name": "Two Seater Sofa", "cubic_meters": 1.1154}, {"id": 1584, "name": "Three Seater Sofa", "cubic_meters": 1.4653}, {"id": 1298, "name": "Four Seater Sofa", "cubic_meters": 1.7527}, {"id": 1090, "name": "Armchair", "cubic_meters": 1.1664}, {"id": 1191, "name": "Coffee Table", "cubic_meters": 0.269}, {"id": 2017, "name": "Small Television/TV (Less than 30\")", "cubic_meters": 0.0666}, {"id": 1386, "name": "Large Television/TV (Greater than 40\")", "cubic_meters": 0.1442}, {"id": 1609, "name": "TV Stand", "cubic_meters": 0.1014}, {"id": 1122, "name": "Bookcase", "cubic_meters": 0.378}, {"id": 1510, "name": "Rug", "cubic_meters": 0.0244}, {"id": 1291, "name": "Floor Lamp", "cubic_meters": 0.1152}]}, {"room": "Kitchen", "items": [{"id": 1891, "name": "Fridge Freezer", "cubic_meters": 0.5575}, {"id": 1627, "name": "Washing Machine", "cubic_meters": 0.4055}, {"id": 1606, "name": "Tumble Dryer", "cubic_meters": 0.306}, {"id": 1412, "name": "Microwave Oven", "cubic_meters": 0.0904}, {"id": 1201, "name": "Cooker", "cubic_meters": 0.888}, {"id": 1224, "name": "Dishwasher", "cubic_meters": 0.4055}, {"id": 1373, "name": "Kitchen Table", "cubic_meters": 0.9576}, {"id": 1112, "name": "Bin", "cubic_meters": 0.1875}, {"id": 2168, "name": "Ironing Board", "cubic_meters": 0.0552}]}, {"room": "Dining", "items": [{"id": 1077, "name": "6 Seater Dining Table", "cubic_meters": 0.9576}, {"id": 1079, "name": "8 Seater Dining Table", "cubic_meters": 1.2804}, {"id": 1832, "name": "Dining Chair", "cubic_meters": 0.2248}, {"id": 1529, "name": "Sideboard", "cubic_meters": 0.4741}, {"id": 1226, "name": "Display Cabinet", "cubic_meters": 0.5268}, {"id": 1075, "name": "4 Seater Dining Table", "cubic_meters": 0.4672}]}, {"room": "Boxes & Bags", "items": [{"id": 1384, "name": "Large Box", "cubic_meters": 0.1664}, {"id": 1411, "name": "Medium Box", "cubic_meters": 0.125}, {"id": 1539, "name": "Small Box", "cubic_meters": 0.0911}, {"id": 2171, "name": "Wardrobe Box", "cubic_meters": 0.2862}, {"id": 2029, "name": "Suitcase", "cubic_meters": 0.1579}, {"id": 1097, "name": "Bag", "cubic_meters": 0.0506}]}, {"room": "Office", "items": [{"id": 1430, "name": "Office Chair", "cubic_meters": 0.342}, {"id": 1220, "name": "Desk", "cubic_meters": 0.6013}, {"id": 1379, "name": "Lamp", "cubic_meters": 0.0073}, {"id": 1483, "name": "Printer", "cubic_meters": 0.0161}, {"id": 1873, "name": "Filing Cabinet", "cubic_meters": 0.1557}, {"id": 1196, "name": "Computer", "cubic_meters": 0.2}]}, {"room": "Bathroom", "items": [{"id": 1385, "name": "Large Mirror", "cubic_meters": 0.0413}, {"id": 2014, "name": "Small Mirror", "cubic_meters": 0.0281}, {"id": 1106, "name": "Bathroom Cabinet", "cubic_meters": 0.084}, {"id": 1769, "name": "Bath Tub", "cubic_meters": 0.6545}]}, {"room": "Garden", "items": [{"id": 1900, "name": "Garden Table", "cubic_meters": 1.2}, {"id": 2090, "name": "Garden Chair", "cubic_meters": 0.27}, {"id": 1388, "name": "Lawn Mower", "cubic_meters": 0.0817}, {"id": 1589, "name": "Tool Box", "cubic_meters": 0.016}, {"id": 1110, "name": "Bench", "cubic_meters": 0.3806}, {"id": 1444, "name": "Parasol", "cubic_meters": 0.0848}, {"id": 1773, "name": "Bicycle", "cubic_meters": 0.399}]}] };
  DEMO.plan = { view: "plan", situation: "buying_and_selling", total_gbp: 3278, priced: 5, unpriced: ["Book removals"], stamp_duty: { total_tax: 2500, note: "First-time buyer relief applied.", jurisdiction: "England and Northern Ireland", thresholds_from: "1 April 2025" },
    lines: [
      { step: "Get an EPC", why: "You need a valid Energy Performance Certificate to market a home.", answer: { status: "priced", product: { id: 1081, name: "EPC Assessment", type: "surveys" }, price_gbp: 99, postcode: "M1 1AE", sample: true } },
      { step: "Instruct a conveyancer for the sale", why: "Handles the contract, title and redemption of any mortgage.", answer: { status: "priced", product: { id: 1063, name: "Conveyancing (selling)", type: "legal" }, price_gbp: 1092, postcode: "M1 1AE", sample: true } },
      { step: "Instruct a conveyancer for the purchase", why: "Searches, contracts, the transfer and the SDLT return.", answer: { status: "priced", product: { id: 1062, name: "Conveyancing (buying)", type: "legal" }, price_gbp: 1152, postcode: "SW1A 2AA", sample: true } },
      { step: "Book a survey", why: "A Level 2 survey suits most homes in normal condition.", answer: { status: "priced", product: { id: 2, name: "Level 2 Survey", type: "surveys" }, price_gbp: 499, postcode: "SW1A 2AA", sample: true } },
      { step: "Book removals", why: "Priced from what you're moving and how far.", answer: DEMO.removals },
      { step: "Moving-out clean", why: "Leaves the home ready for the buyers.", answer: { status: "priced", product: { id: 1097, name: "End of Tenancy Clean", type: "cleaning" }, price_gbp: 436, postcode: "M1 1AE", sample: true } },
    ] };
  const DEMO_ADDRESSES = Array.from({ length: 30 }, (_, i) => ({ uprn: String(i + 1), line: `${i * 2 + 41} Barnesdale Road`, town: "Norwich", postcode: "NR4 6LL" }));
  DEMO.estimated = { ...DEMO.value, status: "priced", price_gbp: 499, postcode: "NR4 6LL", property: { address: "75 Barnesdale Road", postcode: "NR4 6LL", uprn: "1" }, assumed: [{ name: "property_price", value: "£200k–£300k", source: "Homedata's estimate for this home" }], band: { min: 200001, max: 300000 } };
  DEMO.lost = { status: "address_not_found", reason: "multiple_matches", postcode: "NR4 6LL", product: { id: 2, name: "Level 2 Survey", type: "surveys" }, said: "75 Barnesdale Rd", sample: true, bands: DEMO.value.bands };
  DEMO.broadband = { view: "broadband", postcode: "NR4 6LL", sort: "price", total: 6, sample: true, continue_url: "https://homemove.com/broadband/compare/NR46LL",
    all_deals: [["NOW", "Brilliant Broadband", 10, 20, 12], ["NOW", "Fab Fibre", 36, 24, 12], ["Vodafone", "Full Fibre 150", 150, 26, 24], ["Sky", "Full Fibre 500", 500, 35, 18], ["BT", "Full Fibre 900", 900, 49.99, 24], ["Hyperoptic", "1Gb", 1000, 45, 24]]
      .map(([provider, name, down, monthly, months], i) => ({ id: i + 1, provider, logo: null, name, download_mbps: down, upload_mbps: Math.round(down / 5), monthly_gbp: monthly, setup_gbp: 0, contract_months: months, offer: null, landline: false, tv: false, features: ["Unlimited usage"] })) };
  DEMO.broadband.deals = DEMO.broadband.all_deals;
  const DEMO_PRICES = { "1039": { "1 Bedroom|Pre-inspection": 499, "2 Bedrooms|Post-Completion": 449 }, "1097": { "1 Bedroom": 209, "2 Bedrooms": 267, "3 Bedrooms": 376, "4 Bedrooms": 484 } };

  const app = $("#app");
  const state = { data: null, args: {}, answers: {}, step: 0 };

  async function callQuote(extra) {
    const d = state.data;
    const args = { service: String(d.product.id), ...(d.postcode ? { postcode: d.postcode } : {}), ...(d.to_postcode ? { to_postcode: d.to_postcode } : {}), ...(d.property?.address ? { address: state.args.address ?? d.property.address.split(",")[0] } : {}), ...state.args, ...extra };
    const oa = window.openai;
    if (oa && typeof oa.callTool === "function") {
      const res = await oa.callTool("homemove_quote", args);
      return res?.structuredContent ?? res;
    }
    await wait(800); // preview only
    const a = args.answers ?? {};
    const key = Object.values(a).join("|");
    const demoBand = d.bands?.find((b) => (args.property_price ?? 280000) >= b.min && (args.property_price ?? 280000) <= b.max);
    const price = DEMO_PRICES[d.product.id]?.[key] ?? demoBand?.price_gbp ?? (args.property_price ? (args.property_price > 400000 ? 599 : 499) : 449);
    if (d.bands) return { status: "priced", product: d.product, price_gbp: price, postcode: args.postcode ?? "", assumed: args.property_price ? [] : [{ name: "property_price", value: demoBand.label, source: "Homedata's estimate for this home" }], answers: [], sample: true, bands: d.bands,
      band: demoBand && { min: demoBand.min, max: demoBand.max }, ...(args.uprn ? { property: { address: args.address, postcode: args.postcode, uprn: args.uprn } } : {}) };
    if (a.beds === "5+ Bedrooms") return { ...d, status: "quoted_by_hand" };
    if (args.uprn && d.product.type === "cleaning" && !a.beds) return { status: "priced", product: d.product, price_gbp: 267, postcode: args.postcode, sample: true, property: { address: args.address, postcode: args.postcode, uprn: args.uprn },
      answers: [{ name: "beds", label: "2 Bedrooms" }], assumed: [{ name: "beds", value: "2 Bedrooms", source: "the property record" }], beds_options: d.questions[0].options };
    if (a.home_size && !args.inventory) {
      const n = { Studio: 0, "1 bedroom": 1, "2 bedrooms": 2, "3 bedrooms": 3, "4 bedrooms": 4, "5+ bedrooms": 5 }[a.home_size] ?? 2;
      return { status: "priced", product: d.product, price_gbp: [420, 560, 760, 1050, 1390, 1720][n], postcode: d.postcode, assumed: [], answers: [], sample: true, indicative: `a typical ${n ? n + "-bedroom" : "studio"} home`,
        move: { from: "SW1A 2AA", to: args.to_postcode, distance_km: 312, cubic_meters: [6.1, 8.9, 13.4, 22.8, 30.2, 38.5][n], van_type: ["Transit (SWB)", "Transit (LWB)", "Luton", "7.5 Tonne", "18 Tonne", "18 Tonne"][n], num_vans: 1, crew_size: n > 2 ? 4 : 3, estimated_hours: 6 + n, items: [{ name: "", quantity: 20 + n * 15 }] } };
    }
    if (args.inventory) {
      const vol = Object.entries(args.inventory).reduce((n, [id, q]) => n + (d.picker.flatMap((r) => r.items).find((i) => String(i.id) === id)?.cubic_meters ?? 0) * q, 0);
      return { status: "priced", product: d.product, price_gbp: Math.max(300, Math.round((3500 * vol + 110 * 300) / 100)), postcode: d.postcode, assumed: [], answers: [], sample: true,
        move: { from: "SW1A 2AA", to: args.to_postcode, distance_km: 300, cubic_meters: Math.round(vol * 10) / 10, van_type: vanFor(vol), num_vans: 1, crew_size: 3, estimated_hours: 7.5, items: Object.values(args.inventory).map((q) => ({ name: "", quantity: q })) } };
    }
    return { status: "priced", product: d.product, price_gbp: price, postcode: d.postcode, assumed: [], answers: Object.entries(a).map(([name, label]) => ({ name, label })), sample: true, ...(args.property_price ? { band: { min: 0, max: args.property_price } } : {}) };
  }

  /** Addresses for the picker, from homemove_find_address (Homedata), newest query wins. */
  async function findAddresses(query) {
    const oa = window.openai;
    if (oa && typeof oa.callTool === "function") {
      const res = await oa.callTool("homemove_find_address", { query });
      return (res?.structuredContent ?? res)?.addresses ?? [];
    }
    await wait(350); // preview only
    return DEMO_ADDRESSES.filter((a) => `${a.line} ${a.postcode}`.toLowerCase().includes(query.toLowerCase().replace(/\s+/g, " ").split(" ")[0]));
  }
  /** A price that sits inside a band, for property_price. */
  const valueIn = (b) => (b.max >= 100000000 ? b.min + 1 : Math.round((b.min + b.max) / 2));
  /** Priced on the home's value, so an address (or a value range) changes the price. */
  const valueBanded = (d) => Array.isArray(d.bands) && d.bands.length > 1;

  function boot() {
    if (!RIG) return fetch(`${A}rig.json`).then((r) => r.json()).then((rig) => { RIG = rig; boot(); });
    const qp = new URLSearchParams(location.search);
    const data = window.openai?.toolOutput ?? (qp.get("demo") ? DEMO[qp.get("demo")] : null);
    if (!data || (!data.status && data.view !== "plan" && data.view !== "broadband")) {
      // The tool result arrives after the widget loads in ChatGPT.
      app.replaceChildren(h("div", { class: "inline" }, sky(), h("div", { class: "copy" }, h("div", { class: "eyebrow" }, "Homemove"), h("h1", {}, "Working out your price…")), h("div", { class: "stage-mini" }, livingHomie("welcome"))));
      return;
    }
    if (data.view === "plan") { state.plan = data; renderPlanInline(); if (qp.get("open") === "1") openPlan(); return; }
    if (data.view === "broadband") { state.bb = data; renderBroadbandInline(); if (qp.get("open") === "1") openBroadband(); return; }
    state.data = data;
    renderInline();
    if (qp.get("open") === "1") openTakeover();
  }
  let RIG_BOOTED = false;
  window.addEventListener("openai:set_globals", () => {
    const out = window.openai?.toolOutput;
    if ((out?.status || out?.view === "plan" || out?.view === "broadband") && state.data !== out && state.plan !== out && state.bb !== out) { state.data = null; state.plan = null; state.bb = null; boot(); }
  });

  // ---------------------------------------------------------------- inline card
  function renderInline() {
    const d = state.data, look = lookFor(d.product?.type);
    const card = h("div", { class: "inline" });
    card.append(sky());
    const copy = h("div", { class: "copy" });
    const estimated = d.status === "priced" && d.property && valueBanded(d) && (d.assumed ?? []).some((a) => a.name === "property_price");
    if (estimated) {
      // Found the home and its estimate: the price waits for them to confirm the value range.
      const from = h("div", { class: "price inline-price", "aria-label": `from ${gbp(Math.min(...d.bands.map((b) => b.price_gbp)))}` });
      copy.append(
        h("div", { class: "eyebrow" }, d.sample ? "Sample price · preview" : "Your Homemove quote"),
        h("h1", {}, d.product.name),
        h("div", { class: "from-row" }, h("span", { class: "from" }, "from"), from),
        h("p", {}, `Found ${d.property.address.split(",")[0]}. Check its value range for your price.`),
        h("div", { class: "inline-actions" }, h("button", { class: "cta", onclick: () => openTakeover("value") }, "Check the value"), h("button", { class: "link", onclick: () => book(d) }, "homemove.com →")));
      rollingPrice(from, Math.min(...d.bands.map((b) => b.price_gbp)));
    } else if (d.status === "address_not_found" && d.product) {
      copy.append(
        h("div", { class: "eyebrow" }, "Homemove"),
        h("h1", {}, "Which home is it?"),
        h("p", {}, `Pick it from the addresses at ${d.postcode} and we'll price your ${d.product.name.toLowerCase()}.`),
        h("div", { class: "inline-actions" }, h("button", { class: "cta", onclick: () => openTakeover("address") }, "Pick the address"), h("button", { class: "link", onclick: () => book(d) }, "homemove.com →")));
    } else if (d.status === "priced") {
      const price = h("div", { class: "price inline-price", "aria-label": gbp(d.price_gbp) });
      // With the home known, the next step is homemove.com. Without it, the card's next step is the address.
      const addressNext = !d.property && valueBanded(d);
      copy.append(
        h("div", { class: "eyebrow" }, d.sample ? "Sample price · preview" : "Your Homemove quote"),
        h("h1", {}, d.product.name),
        price,
        h("p", {}, [d.property?.address ?? d.postcode, d.band ? `value band ${bandText(d.band)}` : null].filter(Boolean).join(" · ")),
        h("div", { class: "inline-actions" },
          addressNext ? h("button", { class: "cta", onclick: () => openTakeover("address") }, "Add your address")
            : h("button", { class: "cta", onclick: () => book(d) }, "Continue on homemove.com"),
          addressNext ? h("button", { class: "link", onclick: () => book(d) }, "homemove.com →")
            : h("button", { class: "link", onclick: () => openTakeover() }, "Details")));
      rollingPrice(price, d.price_gbp);
    } else if (d.status === "needs_answers" && d.from_gbp) {
      const price = h("div", { class: "price inline-price", "aria-label": `from ${gbp(d.from_gbp)}` });
      copy.append(
        h("div", { class: "eyebrow" }, d.sample ? "Sample price · preview" : "Your Homemove quote"),
        h("h1", {}, d.product.name),
        h("div", { class: "from-row" }, h("span", { class: "from" }, "from"), price),
        h("p", {}, "Your exact price depends on the home's value. Pick the address and we'll work it out."),
        h("div", { class: "inline-actions" }, h("button", { class: "cta", onclick: () => openTakeover() }, "Get my exact price"), h("button", { class: "link", onclick: () => book(d) }, "homemove.com →")));
      rollingPrice(price, d.from_gbp);
    } else if (d.status === "needs_answers") {
      copy.append(
        h("div", { class: "eyebrow" }, d.sample ? "Preview" : "Homemove"),
        h("h1", {}, `Let's price your ${d.product.name.toLowerCase()}`),
        h("p", {}, d.product.type === "cleaning" && d.questions.length === 1 && d.questions[0].name === "beds" ? "Pick the address and we'll fill in the bedrooms from the property record." : d.questions.length === 1 ? "One quick question and you'll have your price." : `${d.questions.length} quick questions and you'll have your price.`),
        h("div", { class: "inline-actions" }, h("button", { class: "cta", onclick: () => openTakeover() }, "Get my price"), h("button", { class: "link", onclick: () => book(d) }, "homemove.com →")));
    } else if (d.status === "quoted_by_hand") {
      copy.append(h("div", { class: "eyebrow" }, "Homemove"), h("h1", {}, "This one's priced by hand"), h("p", {}, `A ${d.product.name.toLowerCase()} for this home needs a specialist's quote.`), h("button", { class: "cta", onclick: () => book(d) }, "Get a quote on homemove.com"));
    } else {
      copy.append(h("div", { class: "eyebrow" }, "Homemove"), h("h1", {}, "Let's get the details right"), h("p", {}, "Answer in the chat and I'll price it straight away."), h("button", { class: "link", onclick: () => book(d) }, "Or carry on at homemove.com →"));
    }
    card.append(copy, h("div", { class: "stage-mini" }, livingHomie(look.homie)));
    app.replaceChildren(card);
  }

  // ---------------------------------------------------------------- takeover
  async function openTakeover(mode) {
    try { await window.openai?.requestDisplayMode?.({ mode: "fullscreen" }); } catch { /* inline is fine */ }
    const d = state.data, look = lookFor(d.product?.type);
    app.replaceChildren();
    const root = h("div", { class: "takeover" });
    root.append(sky());
    root.append(h("div", { class: "topbar" }, h("img", { src: `${A}logo-red.png`, alt: "homemove" }), h("button", { class: "close", "aria-label": "Close", onclick: closeTakeover }, "✕")));
    const stage = h("div", { class: "stage" });
    const bubble = h("div", { class: "bubble", role: "status" });
    const slot = h("div", { class: "homie-slot" });
    stage.append(bubble, slot);
    const card = h("div", { class: "card" });
    root.append(h("div", { class: "main" }, card, stage));
    app.append(root);
    state.ui = { stage, bubble, slot, card };
    state.step = 0;
    state.answers = {};

    const bedsOnly = d.status === "needs_answers" && d.product?.type === "cleaning" && d.questions.length === 1 && d.questions[0].name === "beds";
    state.bedsQuestion = bedsOnly ? d.questions[0] : null;
    const pickAddress = mode === "address" || mode === "value" || bedsOnly || (d.status === "needs_answers" && valueBanded(d) && d.questions.every((q) => q.name === "property_price"));
    if (d.status === "address_not_found" && !state.addrQuery) {
      // Start from their postcode, narrowed by the house or flat number they gave.
      const number = (d.said ?? "").match(/^(flat\s*\d+\w*|\d+\w?)\b/i)?.[1];
      state.addrQuery = [d.postcode, number].filter(Boolean).join(" ");
    }
    if (mode === "value" && d.property) { state.args = { ...state.args, address: d.property.address.split(",")[0], uprn: d.property.uprn, postcode: d.property.postcode }; valueStep(d); }
    else if (pickAddress) addressStep(); else if (d.status === "needs_answers") renderStep(); else card.append(h("div", { class: "step" }, h("div", { class: "eyebrow" }, d.product.name), h("h2", {}, "Here it comes…")));

    if (reduced) { slot.append(livingHomie(look.homie)); say(look.hello); }
    else {
      const w = walker();
      w.style.right = "-30%";
      stage.append(w);
      await w.animate([{ right: "-30%" }, { right: "36%" }], { duration: 1400, easing: "cubic-bezier(.3,.6,.4,1)", fill: "forwards" }).finished;
      const living = livingHomie(look.homie);
      living.style.opacity = "0";
      slot.append(living);
      w.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" });
      await spring(living, "bouncy", { y: 16, s: 0.92, o: 0 }, { y: 0, s: 1, o: 1 }, (v) => ({ transform: `translateY(${v.y}px) scale(${v.s})`, opacity: String(Math.min(1, v.o)) }));
      w.remove();
      say(mode === "value" ? "Found it! Does this look right?" : pickAddress ? "Which home is it?" : d.status === "priced" ? "I've got your price!" : look.hello);
    }
    if (d.status === "priced" && !pickAddress) { await wait(300); reveal(d); }
  }

  function closeTakeover() {
    try { window.openai?.requestDisplayMode?.({ mode: "inline" }); } catch { /* ignore */ }
    document.querySelectorAll(".dim,.sheet,.confetti").forEach((el) => el.remove());
    renderInline();
  }

  let sayTimer;
  function say(text) {
    const b = state.ui?.bubble;
    if (!b) return;
    b.classList.remove("on");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { b.textContent = text; b.classList.add("on"); }, reduced ? 0 : 120);
  }

  /** The Homie hops: lift 0 → -22px (snappy) → 0 (bouncy), squash and stretch at the feet. */
  async function hop(el, lift = 22) {
    if (reduced || !el) return;
    el.style.transformOrigin = "50% 100%";
    el.animate([{ transform: "scale(1,1)" }, { transform: "scale(1.05,.94)", offset: 0.25 }, { transform: "scale(.97,1.04)", offset: 0.6 }, { transform: "scale(1.03,.97)", offset: 0.85 }, { transform: "scale(1,1)" }], { duration: 500, easing: "ease-out" });
    await spring(el, "snappy", { y: 0 }, { y: -lift }, (v) => ({ translate: `0 ${v.y}px` }));
    await spring(el, "bouncy", { y: -lift }, { y: 0 }, (v) => ({ translate: `0 ${v.y}px` }));
  }

  const SAYS = ["Ooh, good choice.", "Got it.", "Nearly there…", "Lovely."];

  function renderStep() {
    const d = state.data, qs = d.questions, q = qs[state.step];
    const { card } = state.ui;
    const progress = h("div", { class: "progress" }, qs.map((_, i) => h("i", { class: i < state.step ? "done" : "" })));
    const body = h("div", { class: "step" });
    body.append(h("div", { class: "eyebrow" }, `${d.product.name} · ${state.step + 1} of ${qs.length}`), h("h2", {}, q.question),
      h("p", { class: "sub" }, [d.property?.address, d.postcode].filter(Boolean)[0] ?? ""));
    const last = state.step === qs.length - 1;
    const next = h("button", { class: "cta", disabled: true, onclick: advance }, last ? "Show my price" : "Next");
    const back = h("button", { class: "back", hidden: state.step === 0, onclick: () => go(state.step - 1) }, "← Back");
    const ready = (ok) => { next.disabled = !ok; };

    if (q.name === "to_postcode" || q.name === "postcode") {
      const input = h("input", { inputmode: "text", autocomplete: "postal-code", placeholder: q.name === "postcode" ? "NR4 6LL" : "LS1 4AP", maxlength: 8, value: state.args[q.name] ?? "", "aria-label": q.name === "postcode" ? "Postcode you're moving from" : "Postcode you're moving to" });
      const field = h("label", { class: "field" }, h("span", { class: "pin" }, h("img", { src: `${A}icons/location.webp`, alt: "" })), input);
      const valid = (v) => /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(v.trim());
      input.addEventListener("input", () => {
        const ok = valid(input.value);
        field.classList.toggle("live", ok);
        if (ok) state.args[q.name] = input.value.trim().toUpperCase().replace(/\s*(\d[A-Z]{2})$/, " $1");
        ready(ok);
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && valid(input.value)) advance(); });
      body.append(field);
      ready(valid(input.value));
      setTimeout(() => input.focus({ preventScroll: true }), 300);
    } else if (q.name === "home_size" && d.picker) {
      const tiles = h("div", { class: "tiles sizes", role: "radiogroup" });
      q.options.forEach((label, i) => {
        const house = h("img", { src: `${A}icons/home.webp`, alt: "", style: `transform:scale(${0.62 + i * 0.09})` });
        const chosen = state.answers[q.name] === label;
        const tile = h("button", { class: "tile" + (chosen ? " sel" : ""), role: "radio", "aria-checked": String(chosen) }, house, h("span", {}, h("b", {}, label)), h("span", { class: "tick" }, svgTick()));
        tile.addEventListener("click", () => {
          tiles.querySelectorAll(".tile").forEach((t) => { t.classList.remove("sel"); t.setAttribute("aria-checked", "false"); });
          tile.classList.add("sel"); tile.setAttribute("aria-checked", "true");
          state.answers[q.name] = label;
          ready(true);
          hop(house, 8); hop(state.ui.slot.firstElementChild, 10);
        });
        if (!reduced) tile.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: 100 + i * 40, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
        tiles.append(tile);
      });
      body.append(tiles, h("button", { class: "link", onclick: () => { d.questions[state.step] = { name: "inventory", question: "What are you moving?", options: [] }; delete state.answers.home_size; renderStep(); } }, "List my things instead →"));
      ready(state.answers[q.name] != null);
    } else if (q.name === "inventory") {
      body.append(inventoryPicker(d.picker ?? [], ready));
    } else if (q.options.length) {
      const tiles = h("div", { class: "tiles", role: "radiogroup" });
      q.options.forEach((label, i) => {
        const icon = h("img", { src: `${A}icons/${ICON[q.name] ?? "checklist"}.webp`, alt: "", onerror: (e) => { e.target.src = `${A}icons/home.webp`; } });
        const chosen = state.answers[q.name] === label;
        const tile = h("button", { class: "tile" + (chosen ? " sel" : ""), role: "radio", "aria-checked": String(chosen) },
          icon, h("span", {}, h("b", {}, label)), h("span", { class: "tick" }, svgTick()));
        tile.addEventListener("click", () => {
          tiles.querySelectorAll(".tile").forEach((t) => { t.classList.remove("sel"); t.setAttribute("aria-checked", "false"); });
          tile.classList.add("sel"); tile.setAttribute("aria-checked", "true");
          state.answers[q.name] = label;
          ready(true);
          spring(icon, "snappy", { y: 0 }, { y: -6 }, (v) => ({ translate: `0 ${v.y}px` })).then(() => spring(icon, "bouncy", { y: -6 }, { y: 0 }, (v) => ({ translate: `0 ${v.y}px` })));
          hop(state.ui.slot.firstElementChild, 10);
        });
        if (!reduced) tile.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 450, delay: 120 + Math.min(i, 6) * 40, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
        tiles.append(tile);
      });
      body.append(tiles);
      ready(state.answers[q.name] != null);
    } else {
      // The value band: a slider over the band edges people think in.
      const idx = Math.max(0, VALUE_STOPS.indexOf(state.args.property_price ?? 300000));
      const num = h("div", { class: "num", "aria-live": "polite" });
      const house = h("img", { class: "house", src: `${A}icons/home.webp`, alt: "" });
      const range = h("input", { type: "range", min: 0, max: VALUE_STOPS.length - 1, step: 1, value: idx, "aria-label": "Property value" });
      const chips = h("div", { class: "chips" });
      const set = (i, kick) => {
        const v = VALUE_STOPS[i];
        state.args.property_price = v;
        num.textContent = v >= 2000000 ? "£2m+" : gbp(v);
        range.value = i;
        range.style.setProperty("--p", `${(i / (VALUE_STOPS.length - 1)) * 100}%`);
        const s = 0.72 + (i / (VALUE_STOPS.length - 1)) * 0.6;
        if (kick && !reduced) spring(house, "bouncy", { s: s * 0.9 }, { s }, (z) => ({ transform: `scale(${z.s})` })); else house.style.transform = `scale(${s})`;
        chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("sel", Number(c.dataset.i) === i));
        ready(true);
      };
      [[2, "£200k"], [5, "£400k"], [7, "£600k"], [9, "£1m"]].forEach(([i, label]) => chips.append(h("button", { class: "chip", "data-i": i, onclick: () => set(i, true) }, label)));
      range.addEventListener("input", () => set(Number(range.value), true));
      body.append(h("div", { class: "value" }, num, house), range, chips);
      set(idx, false);
    }
    body.append(h("div", { class: "actions" }, back, next));
    card.replaceChildren(progress, body);
    requestAnimationFrame(() => setTimeout(() => progress.children[state.step]?.classList.add("done"), 60));
  }

  // ---------------------------------------------------------------- the address, then the value
  // Two steps before the reveal. 1: which home (a postcode lists its homes, anything else searches).
  // 2: what it's worth, as ranges with no prices on them, pre-picked from Homedata's estimate when the
  // home has one. The price is only shown in the reveal.
  const steps = (i) => h("div", { class: "progress" }, [0, 1].map((n) => h("i", { class: n < i ? "done" : "" })));

  function addressStep() {
    const d = state.data, { card } = state.ui;
    const body = h("div", { class: "step" });
    const from = d.from_gbp ?? (d.bands ? Math.min(...d.bands.map((b) => b.price_gbp)) : null);
    const input = h("input", { class: "addr-input", inputmode: "search", autocomplete: "off", spellcheck: "false", placeholder: "Postcode or address", "aria-label": "Postcode or address", value: state.addrQuery ?? "" });
    const field = h("label", { class: "field addr" }, h("span", { class: "pin" }, h("img", { src: `${A}icons/location.webp`, alt: "" })), input);
    const list = h("ul", { class: "addr-list", role: "listbox", "aria-label": "Addresses" });
    const status = h("p", { class: "addr-status", "aria-live": "polite" }, "");
    let seq = 0, timer, cached = { pc: null, rows: [] };
    const PC = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/i;
    const show = (rows, filter) => {
      const words = (filter ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const shown = rows.filter((a) => words.every((w) => `${a.line} ${a.town}`.toLowerCase().includes(w)));
      status.textContent = rows.length && !shown.length ? "No address there matches. Check the number?" : shown.length > 8 ? `${shown.length} homes: scroll, or type the house number.` : "";
      list.replaceChildren(...shown.map((a, i) => {
        const li = h("li", {}, h("button", { class: "addr-row", role: "option", onclick: () => pick(a) },
          h("img", { src: `${A}icons/home.webp`, alt: "" }), h("span", {}, h("b", {}, a.line), h("small", {}, [a.town, a.postcode].filter(Boolean).join(" · ")))));
        if (!reduced && i < 10) li.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: i * 30, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
        return li;
      }));
      list.scrollTop = 0;
    };
    const search = async () => {
      const q = input.value.trim();
      state.addrQuery = q;
      const pc = PC.exec(q);
      if (q.length < 3) { list.replaceChildren(); status.textContent = ""; return; }
      // A postcode is looked up once; anything typed beside it filters that list here.
      const key = pc ? (pc[1] + pc[2]).toUpperCase() : null;
      const rest = pc ? q.replace(pc[0], "").trim() : "";
      if (key && cached.pc === key) return show(cached.rows, rest);
      const mine = ++seq;
      field.classList.add("live");
      try {
        const rows = await findAddresses(key ? `${pc[1]} ${pc[2]}` : q);
        if (mine !== seq) return;
        if (key) cached = { pc: key, rows };
        show(rows, rest);
        if (!rows.length) status.textContent = key ? "No homes found at that postcode." : "Nothing found yet. Try the postcode.";
      } catch { if (mine === seq) status.textContent = "Couldn't search just now. Try again, or skip the address."; }
      finally { if (mine === seq) field.classList.remove("live"); }
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 300); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); search(); } });

    const pick = async (a) => {
      say("Let me look that up…");
      hop(state.ui.slot.firstElementChild, 12);
      list.replaceChildren(h("li", { class: "addr-picked" }, h("img", { src: `${A}icons/home.webp`, alt: "" }), h("span", {}, h("b", {}, a.line), h("small", {}, "Looking up this home…"))));
      status.textContent = "";
      state.args = { ...state.args, address: a.line, uprn: a.uprn, postcode: a.postcode };
      try {
        // Priced on Homedata's estimate, held back until they confirm the range.
        const next = await callQuote({ answers: Object.fromEntries((d.answers ?? []).map((x) => [x.name, x.label])) });
        if (next?.status === "priced" && next.beds_options) return bedsStep(next, next.beds_options);
        if (next?.status === "priced" && !valueBanded(next)) { state.data = next; return reveal(next); }
        if (next?.status === "priced") return valueStep(next);
        if (next?.status === "needs_answers" && next.questions.length === 1 && next.questions[0].name === "beds") return bedsStep(null, next.questions[0].options);
        if (next?.status === "needs_answers" && next.questions.every((q) => q.name === "property_price")) return valueStep(null);
        if (next?.status === "needs_answers") { state.data = next; state.step = 0; return renderStep(); }
        if (next?.status === "quoted_by_hand") { state.data = next; say("That one needs a specialist."); return; }
        throw new Error("no price");
      } catch { say("Hmm, I couldn't look that up. Try again in a moment?"); }
    };

    body.append(
      h("div", { class: "eyebrow" }, from ? `${d.product.name} · from ${gbp(from)}` : d.product.name),
      h("h2", {}, "Which home is it?"),
      h("p", { class: "sub" }, "Type the postcode and pick the address. Homemove.com will have it ready when you carry on."),
      field, status, list,
      h("button", { class: "link skip", onclick: () => (state.bedsQuestion ? bedsStep(null, state.bedsQuestion.options) : valueStep(null)) }, "Don't have the address yet? Skip →"));
    card.replaceChildren(steps(0), body);
    if (state.addrQuery) search();
    setTimeout(() => input.focus({ preventScroll: true }), 300);
  }

  /** Step 2: the value range, prices hidden. guess is the quote priced on Homedata's estimate, if any. */
  function valueStep(guess) {
    const d = state.data, { card } = state.ui;
    const bands = guess?.bands ?? d.bands ?? [];
    const sameBand = (b) => guess?.band && b.min <= guess.band.min && b.max >= guess.band.max;
    let chosen = bands.find(sameBand) ?? null;
    const body = h("div", { class: "step" });
    const go = h("button", { class: "cta", disabled: !chosen, onclick: async () => {
      go.disabled = true; go.textContent = "Working it out…";
      hop(state.ui.slot.firstElementChild, 14);
      try {
        // Their own range wins over the estimate; the estimate's quote is used only if they kept it.
        const next = chosen && sameBand(chosen) ? guess : await callQuote({ property_price: valueIn(chosen), answers: Object.fromEntries((d.answers ?? []).map((x) => [x.name, x.label])) });
        if (next?.status !== "priced") throw new Error("no price");
        state.data = next;
        if (state.planLine != null && state.plan) { state.plan.lines[state.planLine].answer = next; recountPlan(); }
        reveal(next);
      } catch { go.disabled = false; go.textContent = "Show my price"; say("Hmm, I couldn't price that just now. Try again?"); }
    } }, "Show my price");
    const grid = h("div", { class: "bands", role: "radiogroup" }, bands.map((b, i) => {
      const chip = h("button", { class: "band" + (b === chosen ? " sel" : ""), role: "radio", "aria-checked": String(b === chosen), onclick: () => {
        chosen = b;
        grid.querySelectorAll(".band").forEach((c) => { c.classList.toggle("sel", c === chip); c.setAttribute("aria-checked", String(c === chip)); });
        go.disabled = false;
        say(SAYS[i % SAYS.length]);
        hop(state.ui.slot.firstElementChild, 8);
      } }, h("img", { src: `${A}icons/home.webp`, alt: "", style: `transform:scale(${0.6 + (i / Math.max(1, bands.length - 1)) * 0.5})` }), h("span", {}, b.label));
      if (!reduced) chip.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: 100 + i * 40, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
      return chip;
    }));
    const home = state.args.address;
    body.append(
      h("div", { class: "eyebrow" }, home ? `${d.product.name} · ${home}` : d.product.name),
      h("h2", {}, "What's it worth, roughly?"),
      h("p", { class: "sub" }, chosen ? "We've picked the range from Homedata's estimate for this home. Change it if you know better." : "What you're paying, or roughly what it would sell for."),
      grid,
      h("div", { class: "actions" }, h("button", { class: "back", onclick: () => addressStep() }, "← Back"), go));
    card.replaceChildren(steps(1), body);
    say(chosen ? "Found it! Does this look right?" : "Roughly what's it worth?");
  }

  /** Bedrooms for a bedroom-priced service, pre-picked from the property record when it has them. */
  function bedsStep(guess, options) {
    const d = state.data, { card } = state.ui;
    const was = guess?.answers?.find((a) => a.name === "beds")?.label;
    let chosen = options.includes(was) ? was : null;
    const body = h("div", { class: "step" });
    const go = h("button", { class: "cta", disabled: !chosen, onclick: async () => {
      go.disabled = true; go.textContent = "Working it out…";
      hop(state.ui.slot.firstElementChild, 14);
      try {
        const next = chosen === was && guess ? guess : await callQuote({ answers: { ...Object.fromEntries((d.answers ?? []).map((x) => [x.name, x.label])), beds: chosen } });
        if (next?.status === "priced") { state.data = next; return reveal(next); }
        if (next?.status === "quoted_by_hand") { state.data = next; say("That one needs a specialist."); go.textContent = "Ask in the chat"; return; }
        throw new Error("no price");
      } catch { go.disabled = false; go.textContent = "Show my price"; say("Hmm, I couldn't price that just now. Try again?"); }
    } }, "Show my price");
    const tiles = h("div", { class: "tiles sizes", role: "radiogroup" }, options.map((label, i) => {
      const house = h("img", { src: `${A}icons/home.webp`, alt: "", style: `transform:scale(${0.62 + i * 0.09})` });
      const tile = h("button", { class: "tile" + (label === chosen ? " sel" : ""), role: "radio", "aria-checked": String(label === chosen), onclick: () => {
        chosen = label;
        tiles.querySelectorAll(".tile").forEach((t) => { t.classList.toggle("sel", t === tile); t.setAttribute("aria-checked", String(t === tile)); });
        go.disabled = false; hop(house, 8); hop(state.ui.slot.firstElementChild, 10);
      } }, house, h("span", {}, h("b", {}, label)), h("span", { class: "tick" }, svgTick()));
      return tile;
    }));
    const home = state.args.address;
    body.append(
      h("div", { class: "eyebrow" }, home ? `${d.product.name} · ${home}` : d.product.name),
      h("h2", {}, "How many bedrooms?"),
      h("p", { class: "sub" }, chosen ? "From the property record. Change it if it's not right." : "The clean is priced on the bedrooms."),
      tiles,
      h("div", { class: "actions" }, h("button", { class: "back", onclick: () => addressStep() }, "← Back"), go));
    card.replaceChildren(steps(1), body);
    say(chosen ? "Found it! Is that right?" : "How many bedrooms?");
  }

  function svgTick() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", "M3 8.5l3 3 7-7"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    svg.append(p);
    return svg;
  }

  async function go(i) {
    const body = $(".step", state.ui.card);
    if (body && !reduced) { body.classList.add("out"); await wait(160); }
    state.step = i;
    renderStep();
  }

  async function advance() {
    const qs = state.data.questions;
    say(SAYS[state.step % SAYS.length]);
    if (state.step < qs.length - 1) return go(state.step + 1);
    const btn = $(".cta", state.ui.card);
    btn.disabled = true; btn.textContent = "Working it out…";
    hop(state.ui.slot.firstElementChild, 14);
    try {
      const priorAnswers = Object.fromEntries((state.data.answers ?? []).map((a) => [a.name, a.label]));
      const next = await callQuote({ answers: { ...priorAnswers, ...state.answers }, ...(state.inventory && Object.keys(state.inventory).length ? { inventory: state.inventory } : {}) });
      if (next?.status === "priced") {
        state.data = next;
        if (state.planLine != null && state.plan) { state.plan.lines[state.planLine].answer = next; recountPlan(); }
        return reveal(next);
      }
      if (next?.status === "needs_answers") { state.data = next; state.step = 0; say("Just one more thing…"); return renderStep(); }
      if (next?.status === "quoted_by_hand") { state.data = next; say("That one needs a specialist."); btn.textContent = "Ask in the chat"; return; }
      throw new Error("no price");
    } catch {
      btn.disabled = false; btn.textContent = "Show my price";
      say("Hmm, I couldn't price that just now. Try again in a moment?");
    }
  }

  // ---------------------------------------------------------------- the reveal (Joy/Celebration.swift)
  function bandText(b) {
    const f = (n) => (n >= 1000000 ? `£${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}m` : `£${Math.round(n / 1000)}k`);
    if (b.max >= 100000000) return `over ${f(b.min - 1)}`;
    return b.min <= 1 ? `up to ${f(b.max)}` : `${f(b.min - 1)}–${f(b.max)}`;
  }

  function rollingPrice(el, target) {
    const digits = String(Math.round(target)).length;
    const cols = [];
    el.replaceChildren(h("span", { class: "cur" }, "£"));
    for (let i = 0; i < digits; i++) {
      if (i > 0 && (digits - i) % 3 === 0) el.append(h("span", { class: "sep" }, ","));
      const strip = h("span", {}, Array.from({ length: 10 }, (_, n) => h("b", {}, String(n))));
      el.append(h("span", { class: "col" }, strip)); cols.push(strip);
    }
    const setTo = (v) => {
      const s = String(Math.round(v)).padStart(digits, "0");
      cols.forEach((strip, i) => { strip.style.transform = `translateY(-${Number(s[i]) * 10}%)`; });
    };
    if (reduced) { setTo(target); return Promise.resolve(); }
    return new Promise((done) => {
      const t0 = performance.now(), dur = 800;
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        setTo(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  }

  async function reveal(q) {
    const look = lookFor(q.product?.type);
    const dim = h("div", { class: "dim" });
    const conf = h("canvas", { class: "confetti" });
    const lander = h("img", { src: `${A}poses/${look.cheer}.webp`, alt: "" });
    if (q.move && !reduced) {
      // The van drives across before the mover lands.
      const van = h("img", { class: "drive-van", src: `${A}poses/removals-van.webp`, alt: "" });
      document.body.append(van);
      van.animate([{ transform: "translateX(-40vw)" }, { transform: "translateX(140vw)" }], { duration: 1600, easing: "cubic-bezier(.45,.05,.55,.95)" }).finished.then(() => van.remove());
      van.animate([{ translate: "0 0" }, { translate: "0 -2px" }], { duration: 320, iterations: 6, direction: "alternate" });
    }
    const price = h("div", { class: "price", "aria-label": gbp(q.price_gbp) });
    const m = q.move;
    const rows = m ? [
      ["Route", `${m.from} → ${m.to}${m.distance_km != null ? ` · ${m.distance_km} km` : ""}`],
      ["Load", `${m.cubic_meters} m³ · ${m.num_vans > 1 ? `${m.num_vans} × ` : ""}${m.van_type}`],
      ["Crew", `${m.crew_size} movers · about ${m.estimated_hours} hours`],
      ["Items", m.items.reduce((n, i) => n + i.quantity, 0) + " things"],
    ] : [
      ["Service", q.product.name],
      ...(q.breakdown ?? []).map((r) => [r.label, gbp(r.amount_gbp)]),
      q.property?.address ? ["Property", q.property.address] : q.postcode ? ["Postcode", q.postcode] : null,
      ...(q.band ? [["Value band", bandText(q.band)]] : []),
      ...(q.answers ?? []).filter((a) => !["property_price", "to_postcode"].includes(a.name)).map((a) => [a.name === "beds" ? "Bedrooms" : a.name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), a.label]),
    ].filter(Boolean);
    const assumed = (q.assumed ?? []).map((a) => `${({ beds: "Bedrooms", tenure: "Tenure", property_price: "Value" })[a.name] ?? a.name} from ${a.source}`).join(" · ");
    const sheet = h("div", { class: "sheet", role: "dialog", "aria-label": "Your quote" },
      h("div", { class: "quote" },
        h("div", { class: "lander" }, lander),
        q.unmatched?.length ? h("p", { class: "note" }, `Not in this price: ${q.unmatched.join(", ")}. Tell us what's closest.`) : null,
        q.sample ? h("span", { class: "sample", title: "Preview only: a sample figure. In ChatGPT this is your real Homemove price." }, "Sample price") : null,
        h("div", { class: "for" }, q.property?.address ? `Your ${q.product.name} for ${q.property.address.split(",")[0]}` : `Your ${q.product.name}`),
        price,
        h("p", { class: "note" }, [q.indicative ? `Indicative, based on ${q.indicative}. List your own things for an exact guide price.` : null, assumed ? `${assumed}. Tell us if that's not right.` : null, ...(q.extras ?? []).map((x) => `${x.label}: ${gbp(x.amount_gbp)}, shown separately.`), "Confirmed when you book."].filter(Boolean).join(" ")),
        h("dl", {}, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
        h("div", { class: "bar" },
          h("button", { class: "ghost", onclick: () => { dismiss(); if (state.plan && state.planLine != null) { state.planLine = null; openPlan(); } else closeTakeover(); } }, state.plan && state.planLine != null ? "Back to my move" : "Close"),
          !q.property && valueBanded(q) && state.ui?.card
            ? h("button", { class: "cta", onclick: () => { dismiss(); addressStep(); say("Which home is it?"); } }, "Add your address")
            : h("button", { class: "cta", onclick: () => book(q) }, "Continue on homemove.com"))));
    document.body.append(dim, sheet, conf);
    const dismiss = () => { dim.remove(); sheet.remove(); conf.remove(); };
    dim.addEventListener("click", dismiss);
    lander.style.opacity = "0";
    requestAnimationFrame(() => dim.classList.add("on"));
    spring(sheet, "smooth", { y: 110 }, { y: 0 }, (v) => ({ transform: `translate(-50%, ${v.y}%)` }));
    await wait(120);
    spring(lander, "bouncy", { y: 44, s: 0.6, o: 0 }, { y: 0, s: 1, o: 1 }, (v) => ({ transform: `translateY(${v.y}px) scale(${v.s})`, opacity: String(Math.min(1, Math.max(0, v.o))) }));
    await wait(200);
    confetti(conf);
    const counting = rollingPrice(price, q.price_gbp);
    await wait(300);
    hop(lander);
    await counting;
    if (!reduced) price.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.2,1.3,.4,1)" });
    say("There you go!");
  }

  async function book(q) {
    const oa = window.openai;
    // Booking happens on homemove.com's own quote wizard, opened on this product and postcode.
    const href = q.continue_url ?? q.booking_url ?? "https://homemove.com/";
    if (oa?.openExternal) return oa.openExternal({ href });
    return window.open(href, "_blank", "noopener");
    say("Ask in the chat and I'll help you book.");
  }

  // ---------------------------------------------------------------- the whole move
  const STEP_ICON = (line) => ({ legal: "legal", surveys: "survey", removals: "removals", cleaning: "cleaning" })[line.answer.product?.type] ?? (/epc|gas|eicr|electrical/i.test(line.step) ? "energy" : "home");
  function recountPlan() {
    const p = state.plan;
    const priced = p.lines.filter((l) => l.answer.status === "priced");
    p.total_gbp = Math.round(priced.reduce((n, l) => n + l.answer.price_gbp, 0) * 100) / 100;
    p.priced = priced.length;
    p.unpriced = p.lines.filter((l) => l.answer.status !== "priced").map((l) => l.step);
  }
  const SITUATION = { buying: "Your purchase", selling: "Your sale", buying_and_selling: "Your sale and purchase", renting: "Your move", landlord: "Your let" };

  function renderPlanInline() {
    const p = state.plan;
    const total = h("div", { class: "price inline-price", "aria-label": gbp(p.total_gbp) });
    app.replaceChildren(h("div", { class: "inline" }, sky(),
      h("div", { class: "copy" },
        h("div", { class: "eyebrow" }, SITUATION[p.situation] ?? "Your move"),
        h("h1", {}, `${p.lines.length} steps, ${p.priced} priced`),
        total,
        h("p", {}, p.unpriced.length ? `Plus ${p.unpriced.length} to price${p.stamp_duty ? ` · stamp duty ${gbp(p.stamp_duty.total_tax)} to HMRC` : ""}` : (p.stamp_duty ? `Stamp duty ${gbp(p.stamp_duty.total_tax)} to HMRC, not included` : "Everything priced")),
        h("div", { class: "inline-actions" }, h("button", { class: "cta", onclick: () => openPlan() }, "See my move"), h("button", { class: "link", onclick: () => book(p) }, "homemove.com →"))),
      h("div", { class: "stage-mini" }, livingHomie("welcome"))));
    rollingPrice(total, p.total_gbp);
  }

  async function openPlan() {
    try { await window.openai?.requestDisplayMode?.({ mode: "fullscreen" }); } catch { /* inline is fine */ }
    const p = state.plan;
    app.replaceChildren();
    document.querySelectorAll(".dim,.sheet,.confetti").forEach((el) => el.remove());
    const root = h("div", { class: "takeover" }, sky(),
      h("div", { class: "topbar" }, h("img", { src: `${A}logo-red.png`, alt: "homemove" }), h("button", { class: "close", "aria-label": "Close", onclick: () => { try { window.openai?.requestDisplayMode?.({ mode: "inline" }); } catch {} renderPlanInline(); } }, "✕")));
    const total = h("div", { class: "plan-total", "aria-label": gbp(p.total_gbp) });
    const list = h("ol", { class: "timeline" });
    p.lines.forEach((line, i) => {
      const a = line.answer;
      const priced = a.status === "priced";
      const li = h("li", { class: "tl" + (priced ? " priced" : "") },
        h("span", { class: "dot" }, h("img", { src: `${A}icons/${STEP_ICON(line)}.webp`, alt: "" })),
        h("div", { class: "tl-body" }, h("b", {}, line.step), h("small", {}, line.why)),
        priced ? h("span", { class: "tl-price" }, gbp(a.price_gbp))
          : a.status === "needs_answers" ? h("button", { class: "chip", onclick: () => { state.planLine = i; state.data = a; state.args = {}; openTakeover(); } }, "Price it →")
          : h("span", { class: "tl-note" }, "Quoted by the team"));
      if (!reduced) li.animate([{ opacity: 0, transform: "translateX(-12px)" }, { opacity: 1, transform: "none" }], { duration: 450, delay: 150 + Math.min(i, 8) * 70, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
      list.append(li);
    });
    const card = h("div", { class: "card plan" },
      h("div", { class: "eyebrow" }, SITUATION[p.situation] ?? "Your move"),
      h("h2", {}, "Your move, priced"),
      h("div", { class: "plan-head" }, total, h("span", {}, `${p.priced} of ${p.lines.length} steps priced`)),
      list,
      p.stamp_duty ? h("div", { class: "tl hmrc" }, h("span", { class: "dot" }, h("img", { src: `${A}icons/money.webp`, alt: "" })),
        h("div", { class: "tl-body" }, h("b", {}, "Stamp duty"), h("small", {}, `Paid to HMRC, not Homemove. ${p.stamp_duty.note}`)), h("span", { class: "tl-price" }, gbp(p.stamp_duty.total_tax))) : null,
      h("p", { class: "note" }, "Homemove prices are confirmed when you book."),
      h("button", { class: "cta wide", onclick: () => book(p) }, "Continue on homemove.com"));
    const stage = h("div", { class: "stage" }, h("div", { class: "bubble on" }, p.unpriced.length ? `${p.unpriced.length} more to price. Tap “Price it”.` : "That's your whole move!"), h("div", { class: "homie-slot" }, livingHomie("welcome")));
    root.append(h("div", { class: "main" }, card, stage));
    app.append(root);
    state.ui = { stage, bubble: stage.querySelector(".bubble"), slot: stage.querySelector(".homie-slot"), card };
    await rollingPrice(total, p.total_gbp);
    if (!p.unpriced.length && !reduced) { const conf = h("canvas", { class: "confetti" }); document.body.append(conf); confetti(conf); setTimeout(() => conf.remove(), 2600); }
  }

  // ---------------------------------------------------------------- broadband
  // Deals as homemove.com's comparison lists them: the user sorts and filters, nothing is called best.
  const money2 = (n) => "£" + (Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const speed = (mbps) => (mbps >= 1000 ? `${+(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`);
  const BB_SPEEDS = [[0, "Any speed"], [30, "30+ Mbps"], [100, "100+ Mbps"], [500, "500+ Mbps"], [900, "900+ Mbps"]];

  function renderBroadbandInline() {
    const b = state.bb, list = b.deals.length ? b.deals : b.all_deals;
    const cheapest = Math.min(...b.all_deals.map((d) => d.monthly_gbp)), fastest = Math.max(...b.all_deals.map((d) => d.download_mbps));
    const price = h("div", { class: "price inline-price", "aria-label": `from ${money2(cheapest)} a month` });
    app.replaceChildren(h("div", { class: "inline" }, sky(),
      h("div", { class: "copy" },
        h("div", { class: "eyebrow" }, b.sample ? "Sample deals · preview" : `Broadband at ${b.postcode}`),
        h("h1", {}, `${b.total} deals here`),
        h("div", { class: "from-row" }, h("span", { class: "from" }, "from"), price, h("span", { class: "from" }, "/month")),
        h("p", {}, `Up to ${speed(fastest)}. ${list.slice(0, 3).map((d) => d.provider).filter((v, i, a) => a.indexOf(v) === i).join(", ")} and more.`),
        h("div", { class: "inline-actions" }, h("button", { class: "cta", onclick: () => openBroadband() }, "Compare deals"), h("button", { class: "link", onclick: () => book(b) }, "homemove.com →"))),
      h("div", { class: "stage-mini" }, livingHomie("welcome"))));
    rollingPrice(price, Math.floor(cheapest));
  }

  async function openBroadband() {
    try { await window.openai?.requestDisplayMode?.({ mode: "fullscreen" }); } catch { /* inline is fine */ }
    const b = state.bb;
    const view = { sort: b.sort ?? "price", min: b.min_mbps ?? 0 };
    app.replaceChildren();
    const list = h("ol", { class: "deals" });
    const count = h("p", { class: "sub" });
    const draw = () => {
      const shown = b.all_deals.filter((d) => d.download_mbps >= view.min)
        .sort((x, y) => view.sort === "speed" ? y.download_mbps - x.download_mbps || x.monthly_gbp - y.monthly_gbp : x.monthly_gbp - y.monthly_gbp || y.download_mbps - x.download_mbps);
      count.textContent = `${shown.length} of ${b.total} deals at ${b.postcode}, ${view.sort === "speed" ? "fastest" : "cheapest"} first.`;
      list.replaceChildren(...shown.map((d, i) => {
        const open = h("button", { class: "cta small", onclick: async () => {
          open.disabled = true; open.textContent = "Opening…";
          try {
            const oa = window.openai;
            const res = oa?.callTool ? await oa.callTool("homemove_broadband_link", { deal_id: d.id, postcode: b.postcode }) : null;
            const url = (res?.structuredContent ?? res)?.url;
            if (url) { if (oa?.openExternal) await oa.openExternal({ href: url }); else window.open(url, "_blank", "noopener"); }
            else if (!oa) window.open(b.continue_url, "_blank", "noopener");
          } catch { say("Couldn't open that deal just now."); }
          open.disabled = false; open.textContent = "See deal";
        } }, "See deal");
        const li = h("li", { class: "deal" },
          h("div", { class: "deal-top" }, d.logo ? h("img", { class: "logo", src: d.logo, alt: d.provider }) : h("b", { class: "logo-text" }, d.provider), h("span", { class: "deal-name" }, d.name)),
          h("div", { class: "deal-facts" },
            h("span", {}, h("b", {}, speed(d.download_mbps)), h("small", {}, "download")),
            h("span", {}, h("b", {}, money2(d.monthly_gbp)), h("small", {}, "a month")),
            h("span", {}, h("b", {}, d.contract_months ? `${d.contract_months} mo` : "—"), h("small", {}, "contract"))),
          h("p", { class: "deal-note" }, [d.setup_gbp ? `${money2(d.setup_gbp)} set-up` : "No set-up fee", d.offer, ...d.features.slice(0, 2)].filter(Boolean).join(" · ")),
          open);
        if (!reduced && i < 8) li.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: i * 40, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
        return li;
      }));
    };
    const sortChips = h("div", { class: "chips" }, [["price", "Cheapest"], ["speed", "Fastest"]].map(([k, label]) =>
      h("button", { class: "chip" + (view.sort === k ? " sel" : ""), onclick: (e) => { view.sort = k; sortChips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("sel", c === e.currentTarget)); draw(); } }, label)));
    const speedChips = h("div", { class: "chips" }, BB_SPEEDS.map(([m, label]) =>
      h("button", { class: "chip" + (view.min === m ? " sel" : ""), onclick: (e) => { view.min = m; speedChips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("sel", c === e.currentTarget)); draw(); } }, label)));
    const card = h("div", { class: "card plan" },
      h("div", { class: "eyebrow" }, b.sample ? "Sample deals · preview" : "Broadband"),
      h("h2", {}, `Broadband at ${b.postcode}`), count, sortChips, speedChips, list,
      h("p", { class: "note" }, "Listed prices from homemove.com's broadband comparison. Check availability and price with the provider before you order. Homemove may earn a commission if you order through a link."),
      h("button", { class: "ghost wide", onclick: () => book(b) }, "See them all on homemove.com"));
    const stage = h("div", { class: "stage" }, h("div", { class: "bubble on" }, "Let's get you connected!"), h("div", { class: "homie-slot" }, livingHomie("welcome")));
    app.append(h("div", { class: "takeover" }, sky(),
      h("div", { class: "topbar" }, h("img", { src: `${A}logo-red.png`, alt: "homemove" }), h("button", { class: "close", "aria-label": "Close", onclick: () => { try { window.openai?.requestDisplayMode?.({ mode: "inline" }); } catch {} renderBroadbandInline(); } }, "✕")),
      h("div", { class: "main" }, card, stage)));
    state.ui = { stage, bubble: stage.querySelector(".bubble"), slot: stage.querySelector(".homie-slot"), card };
    draw();
  }

  // ---------------------------------------------------------------- removals inventory
  const POSE = [[/sofa/i, "removals-sofa"], [/armchair/i, "removals-armchair"], [/wardrobe box/i, "removals-box"], [/wardrobe/i, "removals-wardrobe"], [/bed|mattress/i, "removals-mattress"],
    [/bedside|side table/i, "removals-bedside"], [/drawers|dressing|cabinet|sideboard/i, "removals-drawers"], [/fridge|freezer|washing|dryer|dishwasher|cooker|microwave/i, "removals-fridge"],
    [/television|tv/i, "removals-tv"], [/lamp/i, "removals-lamp"], [/mirror/i, "removals-mirror"], [/dining table|kitchen table|garden table|coffee table|desk/i, "removals-table"],
    [/chair|bench/i, "removals-chair"], [/box|bag|suitcase|bin/i, "removals-box"], [/bookcase/i, "removals-drawers"], [/bicycle|mower|parasol|tool/i, "removals-plant"]];
  const ROOM_POSE = { Bedrooms: "removals-room-bedroom", Living: "removals-room-living", Kitchen: "removals-room-kitchen", Office: "removals-room-office", "Boxes & Bags": "removals-room-storage" };
  const poseFor = (name) => (POSE.find(([re]) => re.test(name)) ?? [null, "removals-box"])[1];
  // LeadService::predictVansNeeded thresholds, so the van on screen matches the one we'll quote.
  const vanFor = (m3) => { const a = m3 * 1.2; return a <= 9.9 ? "Transit (SWB)" : a <= 14.2 ? "Transit (LWB)" : a <= 19.8 ? "Luton" : a <= 34 ? "7.5 Tonne" : a <= 56.6 ? "18 Tonne" : `${Math.ceil(a / 19.8)} × Luton`; };

  function inventoryPicker(rooms, ready) {
    state.inventory = state.inventory ?? {};
    const volumeOf = Object.fromEntries(rooms.flatMap((r) => r.items).map((i) => [String(i.id), i.cubic_meters]));
    const wrap = h("div", { class: "inv" });
    const meter = h("div", { class: "van-meter" }, h("img", { src: `${A}poses/removals-van-open.webp`, alt: "" }), h("div", { class: "fill" }, h("i")), h("b", {}, ""));
    const tabs = h("div", { class: "rooms", role: "tablist" });
    const grid = h("div", { class: "items" });
    const update = (kick) => {
      const m3 = Object.entries(state.inventory).reduce((n, [id, q]) => n + (volumeOf[id] ?? 0) * q, 0);
      const count = Object.values(state.inventory).reduce((n, q) => n + q, 0);
      meter.querySelector("i").style.width = `${Math.min(100, (m3 / 34) * 100)}%`;
      meter.querySelector("b").textContent = count ? `${count} things · about ${m3.toFixed(1)} m³ · ${vanFor(m3)}` : "Tap what you're moving";
      if (kick && !reduced) hop(meter.querySelector("img"), 4);
      ready(count > 0);
    };
    const showRoom = (room) => {
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.room === room.room)));
      grid.replaceChildren(...room.items.map((item, i) => {
        const id = String(item.id);
        const qty = h("span", { class: "qty" }, String(state.inventory[id] ?? 0));
        const img = h("img", { src: `${A}poses/${poseFor(item.name)}.webp`, alt: "" });
        const set = (n) => {
          if (n <= 0) delete state.inventory[id]; else state.inventory[id] = Math.min(100, n);
          qty.textContent = String(state.inventory[id] ?? 0);
          card.classList.toggle("sel", !!state.inventory[id]);
          update(true);
        };
        const card = h("div", { class: "item" + (state.inventory[id] ? " sel" : "") },
          h("button", { class: "add", "aria-label": `Add ${item.name}`, onclick: () => { set((state.inventory[id] ?? 0) + 1); spring(img, "snappy", { y: 0 }, { y: -8 }, (v) => ({ translate: `0 ${v.y}px` })).then(() => spring(img, "bouncy", { y: -8 }, { y: 0 }, (v) => ({ translate: `0 ${v.y}px` }))); } }, img, h("small", {}, item.name.replace(/ \(.*\)$/, ""))),
          h("div", { class: "step-qty" }, h("button", { "aria-label": `Remove ${item.name}`, onclick: () => set((state.inventory[id] ?? 0) - 1) }, "−"), qty, h("button", { "aria-label": `Add ${item.name}`, onclick: () => set((state.inventory[id] ?? 0) + 1) }, "+")));
        if (!reduced) card.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: Math.min(i, 6) * 40, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
        return card;
      }));
    };
    rooms.forEach((room, i) => tabs.append(h("button", { role: "tab", "data-room": room.room, onclick: () => showRoom(room) },
      ROOM_POSE[room.room] ? h("img", { src: `${A}poses/${ROOM_POSE[room.room]}.webp`, alt: "" }) : null, room.room)));
    wrap.append(meter, tabs, grid);
    if (rooms[0]) showRoom(rooms[0]);
    update(false);
    return wrap;
  }

  boot();
})();
