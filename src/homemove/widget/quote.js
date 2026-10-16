// Homemove quote takeover for ChatGPT.
// Homies and their rig come from the iOS app (Resources/Homies, Data/homie-loops.json); springs,
// celebration choreography and confetti physics are ported from Theme.swift and Joy/*.swift so the
// web and the app move the same way. Everything degrades to still frames under reduced motion.
(() => {
  "use strict";
  const A = "assets/";
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
          stars = Array.from({ length: Math.round((W * H) / 5200) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + 0.3, tw: Math.random() < 0.2, ph: Math.random() * 6 }));
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
        for (const s of stars) {
          ctx.globalAlpha = s.tw && !reduced ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 900 + s.ph)) : 0.7;
          ctx.fillStyle = "#fbf8f4"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
        }
        if (!reduced) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    });
    return el;
  }

  // ---------------------------------------------------------------- services
  const VALUE_STOPS = [100000, 150000, 200000, 250000, 300000, 400000, 500000, 600000, 750000, 1000000, 1500000, 2000000];
  const SERVICES = {
    survey: {
      homie: "survey", cheer: "survey-surveyor-cheer", noun: "survey",
      hello: "Hello! I'm your surveyor. Three quick taps and you'll have a price.",
      inline: { eyebrow: "Survey quote", title: "What does a survey cost?", body: "Tell me about the home and I'll price it on the spot." },
      steps: [
        { key: "product", type: "tiles", title: "Which survey do you need?", sub: "Not sure? Level 2 suits most standard homes.", say: "Ooh, good choice.",
          options: [
            { value: "level_2_survey", label: "Level 2 Survey", hint: "Most homes in normal condition", icon: "survey" },
            { value: "level_3_survey", label: "Level 3 Building Survey", hint: "Older, larger or altered homes", icon: "home" },
            { value: "snagging_survey", label: "Snagging Survey", hint: "Brand-new builds, before you move in", icon: "new-build" },
          ] },
        { key: "property_price", type: "value", title: "Roughly what's it worth?", sub: "The price you're paying is perfect. It sets your price band.", say: "Lovely home." },
        { key: "postcode", type: "postcode", title: "Where is it?", sub: "Just the postcode.", say: "Let me work that out…" },
      ],
    },
    cleaning: {
      homie: "cleaning", cheer: "joy-cheer", noun: "clean",
      hello: "Sparkly! Let's price your clean.",
      inline: { eyebrow: "Cleaning quote", title: "How much is a moving clean?", body: "A couple of taps and I'll price it for you." },
      steps: [
        { key: "bedrooms", type: "tiles", title: "How many bedrooms?", sub: "We price cleans on bedrooms.", say: "Got it.",
          options: [1, 2, 3, 4].map((n) => ({ value: n, label: `${n} bedroom${n > 1 ? "s" : ""}`, hint: n === 4 ? "Five or more? We'll quote by hand." : "", icon: "bed" })) },
        { key: "postcode", type: "postcode", title: "Where is it?", sub: "Just the postcode.", say: "Let me work that out…" },
      ],
    },
  };

  // ---------------------------------------------------------------- quote source
  // In ChatGPT the price comes from the get_quote tool (motus pricing, same as homemove.com) via
  // window.openai.callTool. Outside ChatGPT (this preview) it is a clearly marked sample.
  async function getQuote(service, answers) {
    const oa = window.openai;
    if (oa && typeof oa.callTool === "function") {
      const res = await oa.callTool("homemove_quote", { service, ...answers });
      return { ...(res?.structuredContent ?? {}), sample: false };
    }
    await wait(900);
    const SAMPLE = { level_2_survey: 450, level_3_survey: 750, snagging_survey: 350, 1: 160, 2: 210, 3: 260, 4: 320 };
    const base = SAMPLE[answers.product ?? answers.bedrooms] ?? 400;
    const lift = answers.property_price ? Math.max(0, Math.log2(answers.property_price / 250000)) * 120 : 0;
    return { price_gbp: Math.round((base + lift) / 5) * 5, sample: true };
  }

  // ---------------------------------------------------------------- app
  const app = $("#app");
  const state = { service: null, step: 0, answers: {} };

  async function boot() {
    RIG = await fetch(`${A}rig.json`).then((r) => r.json());
    const fromTool = window.openai?.toolOutput ?? {};
    const qp = new URLSearchParams(location.search);
    state.service = SERVICES[fromTool.service] ? fromTool.service : SERVICES[qp.get("service")] ? qp.get("service") : "survey";
    if (qp.get("open") === "1" || window.openai?.displayMode === "fullscreen") openTakeover();
    else renderInline();
  }

  function renderInline() {
    const svc = SERVICES[state.service];
    app.replaceChildren();
    const card = h("div", { class: "inline" });
    card.append(sky());
    const mini = h("div", { class: "stage-mini" }, livingHomie(svc.homie));
    card.append(
      h("div", { class: "copy" },
        h("div", { class: "eyebrow" }, svc.inline.eyebrow),
        h("h1", {}, svc.inline.title),
        h("p", {}, svc.inline.body),
        h("button", { class: "cta", onclick: openTakeover }, "Get my price")),
      mini);
    app.append(card);
  }

  async function openTakeover() {
    try { await window.openai?.requestDisplayMode?.({ mode: "fullscreen" }); } catch { /* inline is fine */ }
    const svc = SERVICES[state.service];
    app.replaceChildren();
    const root = h("div", { class: "takeover" });
    root.append(sky());
    const close = h("button", { class: "close", "aria-label": "Close", onclick: closeTakeover }, "✕");
    root.append(h("div", { class: "topbar" }, h("img", { src: `${A}logo-white.png`, alt: "homemove" }), close));
    const stage = h("div", { class: "stage" });
    const bubble = h("div", { class: "bubble", role: "status" });
    const slot = h("div", { class: "homie-slot" });
    stage.append(bubble, slot);
    const card = h("div", { class: "card" });
    root.append(h("div", { class: "main" }, card, stage));
    app.append(root);
    state.ui = { stage, bubble, slot, card };
    state.step = 0;
    renderStep(true);

    // Entrance: a Homie walks on from the right, then becomes the service's living Homie.
    if (reduced) { slot.append(livingHomie(svc.homie)); say(svc.hello); return; }
    const w = walker();
    w.style.right = "-30%";
    stage.append(w);
    const walkIn = w.animate([{ right: "-30%" }, { right: "36%" }], { duration: 1500, easing: "cubic-bezier(.3,.6,.4,1)", fill: "forwards" });
    await walkIn.finished;
    const living = livingHomie(svc.homie);
    living.style.opacity = "0";
    slot.append(living);
    w.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" });
    await spring(living, "bouncy", { y: 16, s: 0.92, o: 0 }, { y: 0, s: 1, o: 1 }, (v) => ({ transform: `translateY(${v.y}px) scale(${v.s})`, opacity: String(Math.min(1, v.o)) }));
    w.remove();
    say(svc.hello);
  }

  function closeTakeover() {
    try { window.openai?.requestDisplayMode?.({ mode: "inline" }); } catch { /* ignore */ }
    renderInline();
  }

  let sayTimer;
  function say(text) {
    const b = state.ui.bubble;
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

  function renderStep(first = false) {
    const svc = SERVICES[state.service];
    const step = svc.steps[state.step];
    const { card } = state.ui;
    const progress = h("div", { class: "progress" }, svc.steps.map((_, i) => h("i", { class: i < state.step ? "done" : "" })));
    const body = h("div", { class: "step" });
    body.append(h("div", { class: "eyebrow" }, `Step ${state.step + 1} of ${svc.steps.length}`), h("h2", {}, step.title), h("p", { class: "sub" }, step.sub));
    const next = h("button", { class: "cta", disabled: true, onclick: advance }, state.step === svc.steps.length - 1 ? "Show my price" : "Next");
    const back = h("button", { class: "back", hidden: state.step === 0, onclick: () => go(state.step - 1) }, "← Back");
    const ready = (ok) => { next.disabled = !ok; };

    if (step.type === "tiles") {
      const tiles = h("div", { class: "tiles", role: "radiogroup" });
      step.options.forEach((opt, i) => {
        const icon = h("img", { src: `${A}icons/${opt.icon}.webp`, alt: "" });
        const tile = h("button", { class: "tile" + (state.answers[step.key] === opt.value ? " sel" : ""), role: "radio", "aria-checked": String(state.answers[step.key] === opt.value) },
          icon, h("span", {}, h("b", {}, opt.label), opt.hint ? h("small", {}, opt.hint) : null),
          h("span", { class: "tick" }, svgTick()));
        tile.addEventListener("click", () => {
          tiles.querySelectorAll(".tile").forEach((t) => { t.classList.remove("sel"); t.setAttribute("aria-checked", "false"); });
          tile.classList.add("sel"); tile.setAttribute("aria-checked", "true");
          state.answers[step.key] = opt.value;
          ready(true);
          // Choice tiles: the Homie icon hops 3px on the bouncy spring (ServiceKit.swift).
          spring(icon, "snappy", { y: 0 }, { y: -6 }, (v) => ({ translate: `0 ${v.y}px` })).then(() => spring(icon, "bouncy", { y: -6 }, { y: 0 }, (v) => ({ translate: `0 ${v.y}px` })));
          hop(state.ui.slot.firstElementChild, 10);
        });
        if (!reduced && first !== "skip") tile.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 450, delay: 120 + Math.min(i, 6) * 40, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
        tiles.append(tile);
      });
      body.append(tiles);
      ready(state.answers[step.key] != null);
    }

    if (step.type === "value") {
      const idx = Math.max(0, VALUE_STOPS.indexOf(state.answers.property_price ?? 300000));
      const num = h("div", { class: "num", "aria-live": "polite" });
      const house = h("img", { class: "house", src: `${A}icons/home.webp`, alt: "" });
      const range = h("input", { type: "range", min: 0, max: VALUE_STOPS.length - 1, step: 1, value: idx, "aria-label": "Property value" });
      const chips = h("div", { class: "chips" });
      const set = (i, kick) => {
        const v = VALUE_STOPS[i];
        state.answers.property_price = v;
        num.textContent = v >= 2000000 ? "£2m+" : gbp(v);
        range.value = i;
        range.style.setProperty("--p", `${(i / (VALUE_STOPS.length - 1)) * 100}%`);
        const s = 0.72 + (i / (VALUE_STOPS.length - 1)) * 0.6;
        if (kick && !reduced) spring(house, "bouncy", { s: s * 0.9 }, { s }, (q) => ({ transform: `scale(${q.s})` }));
        else house.style.transform = `scale(${s})`;
        chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("sel", Number(c.dataset.i) === i));
        ready(true);
      };
      [[2, "£200k"], [5, "£400k"], [7, "£600k"], [9, "£1m"]].forEach(([i, label]) => chips.append(h("button", { class: "chip", "data-i": i, onclick: () => set(i, true) }, label)));
      range.addEventListener("input", () => set(Number(range.value), true));
      body.append(h("div", { class: "value" }, num, house), range, chips);
      set(idx, false);
    }

    if (step.type === "postcode") {
      const input = h("input", { inputmode: "text", autocomplete: "postal-code", placeholder: "SW1A 2AA", maxlength: 8, value: state.answers.postcode ?? "", "aria-label": "Postcode" });
      const field = h("label", { class: "field" }, h("span", { class: "pin" }, h("img", { src: `${A}icons/location.webp`, alt: "" })), input);
      const err = h("div", { class: "err", role: "alert" });
      const valid = (v) => /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(v.trim());
      input.addEventListener("input", () => {
        const ok = valid(input.value);
        field.classList.toggle("live", ok);
        err.classList.remove("on");
        if (ok) state.answers.postcode = input.value.trim().toUpperCase().replace(/\s*(\d[A-Z]{2})$/, " $1");
        ready(ok);
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { if (valid(input.value)) advance(); else { err.textContent = "That doesn't look like a UK postcode."; err.classList.add("on"); } } });
      body.append(field, err);
      ready(valid(input.value));
      if (valid(input.value)) field.classList.add("live");
      setTimeout(() => input.focus({ preventScroll: true }), 300);
    }

    body.append(h("div", { class: "actions" }, back, next));
    card.replaceChildren(progress, body);
    requestAnimationFrame(() => progress.querySelectorAll("i").forEach((el, i) => { if (i < state.step + 1 && i === state.step) setTimeout(() => el.classList.add("done"), 60); }));
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
    const svc = SERVICES[state.service];
    const step = svc.steps[state.step];
    say(step.say);
    if (state.step < svc.steps.length - 1) return go(state.step + 1);
    // Last step: work out the price, then the big reveal.
    const btn = $(".cta", state.ui.card);
    btn.disabled = true; btn.textContent = "Working it out…";
    hop(state.ui.slot.firstElementChild, 14);
    try {
      const quote = await getQuote(state.service, state.answers);
      if (!(quote.price_gbp > 0)) throw new Error("no price");
      reveal(quote);
    } catch {
      btn.disabled = false; btn.textContent = "Show my price";
      say("Hmm, I couldn't price that just now. Try again in a moment?");
    }
  }

  // ---------------------------------------------------------------- the reveal (Joy/Celebration.swift)
  function rollingPrice(el, target) {
    const digits = String(Math.round(target)).length;
    const cols = [];
    el.replaceChildren(h("span", { class: "cur" }, "£"));
    for (let i = 0; i < digits; i++) {
      if (i > 0 && (digits - i) % 3 === 0) el.append(h("span", { class: "sep" }, ","));
      const strip = h("span", {}, Array.from({ length: 10 }, (_, d) => h("b", {}, String(d))));
      const col = h("span", { class: "col" }, strip);
      el.append(col); cols.push(strip);
    }
    const setTo = (v) => {
      const s = String(Math.round(v)).padStart(digits, "0");
      cols.forEach((strip, i) => { strip.style.transform = `translateY(-${Number(s[i]) * 10}%)`; });
    };
    if (reduced) { setTo(target); return Promise.resolve(); }
    return new Promise((done) => {
      const t0 = performance.now(), dur = 800;
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        setTo(target * e);
        if (p < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  }

  async function reveal(quote) {
    const svc = SERVICES[state.service];
    const a = state.answers;
    const product = svc.steps[0].options.find((o) => o.value === (a.product ?? a.bedrooms));
    const dim = h("div", { class: "dim" });
    const conf = h("canvas", { class: "confetti" });
    const lander = h("img", { src: `${A}poses/${svc.cheer}.webp`, alt: "" });
    const price = h("div", { class: "price", "aria-label": gbp(quote.price_gbp) });
    const rows = [["Service", product?.label ?? svc.noun], a.property_price ? ["Property value", a.property_price >= 2000000 ? "£2m+" : gbp(a.property_price)] : null, ["Postcode", a.postcode]].filter(Boolean);
    const sheet = h("div", { class: "sheet", role: "dialog", "aria-label": "Your quote" },
      h("div", { class: "quote" },
        h("div", { class: "lander" }, lander),
        quote.sample ? h("span", { class: "sample", title: "Preview only: a made-up figure. In ChatGPT this is your real Homemove price." }, "Sample price") : null,
        h("div", { class: "for" }, `Your ${(product?.label ?? svc.noun).toLowerCase()}`),
        price,
        h("p", { class: "note" }, quote.note ?? "Confirmed when you book."),
        h("dl", {}, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
        h("div", { class: "bar" },
          h("button", { class: "ghost", onclick: () => { dismiss(); go(0); } }, "Change"),
          h("button", { class: "cta", onclick: () => book(quote) }, `Book this ${svc.noun}`))));
    document.body.append(dim, sheet, conf);
    const dismiss = () => { dim.remove(); sheet.remove(); conf.remove(); };
    dim.addEventListener("click", dismiss);
    lander.style.opacity = "0";
    requestAnimationFrame(() => dim.classList.add("on"));
    // Sheet slides up (smooth), the Homie lands from 44px low at 0.6 scale (bouncy, +120ms),
    // the price counts up, confetti bursts, and at 620ms the Homie does its one hop.
    spring(sheet, "smooth", { y: 110 }, { y: 0 }, (v) => ({ transform: `translate(-50%, ${v.y}%)` }));
    await wait(120);
    spring(lander, "bouncy", { y: 44, s: 0.6, o: 0 }, { y: 0, s: 1, o: 1 }, (v) => ({ transform: `translateY(${v.y}px) scale(${v.s})`, opacity: String(Math.min(1, Math.max(0, v.o))) }));
    await wait(200);
    confetti(conf);
    const counting = rollingPrice(price, quote.price_gbp);
    await wait(300);
    hop(lander);
    await counting;
    if (!reduced) price.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.2,1.3,.4,1)" });
    say("There you go!");
  }

  async function book(quote) {
    const oa = window.openai;
    if (quote.booking_url && oa?.openExternal) return oa.openExternal({ href: quote.booking_url });
    if (oa?.sendFollowUpMessage) return oa.sendFollowUpMessage({ prompt: `Book the ${SERVICES[state.service].noun} I was just quoted.` });
    say("In ChatGPT this takes you to booking.");
  }

  boot();
})();
