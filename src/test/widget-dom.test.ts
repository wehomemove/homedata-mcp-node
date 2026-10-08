import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { HOME_WIDGET_SCRIPT } from "../home/widget.js";

/**
 * The Home widget in a real DOM (jsdom): real focus, real keyboard events, real
 * descendants. The string-level harness in home.test.ts cannot see focus moving,
 * a nested control's default action or the map camera, so the property sheet's
 * keyboard, focus and camera behaviour is proved here.
 */
type Camera = { center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number };

function widget(callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>, meta?: Record<string, unknown>, imageOf?: Record<string, string>) {
  const dom = new JSDOM(
    '<!doctype html><html><body><main id="root" class="shell"><div class="empty">Finding beautiful homes…</div></main>' +
    '<div id="home-widget-config" hidden data-check-in-origin="" data-view-id="" data-mapbox-token="pk.test"></div></body></html>',
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://sandbox.test/" },
  );
  const window = dom.window as unknown as Record<string, any>;
  const document = dom.window.document;
  const camera: Camera = { center: { lng: -2.36, lat: 51.38 }, zoom: 12, pitch: 0, bearing: 0 };
  const calls: Array<[string, Record<string, unknown>]> = [];
  const moves: string[] = [];
  let mapCount = 0;
  class FakeMap {
    // The first map is the listings map and drives `camera`; later ones (the sheet's) keep their own.
    private cam: Camera = mapCount++ === 0 ? camera : { center: { lng: 0, lat: 0 }, zoom: 0, pitch: 0, bearing: 0 };
    constructor() {}
    addControl() {} fitBounds() {} remove() {} on() {} once() {} setLight() {}
    getSource() { return undefined; } getLayer() { return undefined; } addLayer() {} addSource() {}
    project() { return { x: 0, y: 0 }; }
    getCenter() { return { ...this.cam.center }; } getZoom() { return this.cam.zoom; } getPitch() { return this.cam.pitch; } getBearing() { return this.cam.bearing; }
    stop() { if (this.cam === camera) moves.push("stop"); }
    private move(how: string, o: Partial<Camera> & { center?: [number, number] | { lng: number; lat: number } }) {
      if (this.cam === camera) moves.push(how);
      if (o.center) this.cam.center = Array.isArray(o.center) ? { lng: o.center[0], lat: o.center[1] } : { ...o.center };
      for (const key of ["zoom", "pitch", "bearing"] as const) if (typeof o[key] === "number") this.cam[key] = o[key]!;
    }
    flyTo(o: any) { this.move("fly", o); } easeTo(o: any) { this.move("ease", o); } jumpTo(o: any) { this.move("jump", o); }
  }
  window["mapboxgl"] = { Map: FakeMap, Marker: class { setLngLat() { return this; } addTo() { return this; } }, LngLatBounds: class { extend() { return this; } }, NavigationControl: class {}, accessToken: "" };
  window["matchMedia"] = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window["openai"] = { callTool: (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return callTool(name, args); } };
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => 600 });
  const scrolls: Array<{ cls: string; left: number }> = [];
  (dom.window.HTMLElement.prototype as any).scrollTo = function (this: HTMLElement, o: { left: number }) { scrolls.push({ cls: this.className, left: o.left }); this.scrollLeft = o.left; };
  dom.window.eval(HOME_WIDGET_SCRIPT);
  const homes = [
    { id: "home-a", address: "1 Card Street", price: 400000, url: "https://home.co.uk/property/home-a", image: "https://cdn.home.co.uk/a.jpg", coordinates: { latitude: 51.38, longitude: -2.36 } },
    { id: "home-b", address: "2 Card Street", price: 500000, url: "https://home.co.uk/property/home-b", image: "https://cdn.home.co.uk/b.jpg", coordinates: { latitude: 51.39, longitude: -2.35 } },
  ];
  for (const home of homes) if (imageOf?.[home.id]) home.image = imageOf[home.id]!;
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { source: dom.window as any, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { view: "listings", homes }, ...(meta ? { _meta: meta } : {}) } } }));
  const key = (target: Element, key: string, shiftKey = false) => {
    const event = new dom.window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const card = (i: number) => document.querySelector(`.card[data-index="${i}"]`) as HTMLElement;
  const sheet = () => document.querySelector(".sheet") as HTMLElement | null;
  const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
  return { dom, document, camera, calls, moves, scrolls, key, card, sheet, settle, root: document.getElementById("root")! };
}

function deferred() {
  let resolve!: (value: unknown) => void, reject!: (reason: unknown) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("Enter and Space on the card's own controls keep their own action and never open the sheet", async () => {
  const w = widget(async () => ({ structuredContent: { id: "home-a" } }));
  const save = w.card(0).querySelector("[data-save]") as HTMLElement;
  for (const name of ["Enter", " "]) {
    save.focus();
    const event = w.key(save, name);
    assert.equal(event.defaultPrevented, false, `${JSON.stringify(name)} on Save keeps the button's own activation`);
  }
  const view = w.card(0).querySelector("[data-open]") as HTMLButtonElement;
  assert.ok(view, "the card has its View button");
  view.focus();
  assert.equal(w.key(view, "Enter").defaultPrevented, false, "Enter on View is left to the button's own activation");
  await w.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(w.calls)), []);
  assert.equal(w.sheet()?.classList.contains("open") ?? false, false);

  w.card(0).focus();
  assert.equal(w.key(w.card(0), "Enter").defaultPrevented, true, "Enter on the card itself opens the home");
  await w.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(w.calls)), [["get_home", { listing_id: "home-a" }]]);
  assert.ok(w.sheet()!.classList.contains("open"));
});

test("a card's View opens the details in the app, never a new page", async () => {
  const w = widget(async () => ({ structuredContent: { id: "home-b", description: "Full." } }));
  const view = w.card(1).querySelector("[data-open]") as HTMLButtonElement;
  assert.equal(view.tagName, "BUTTON");
  assert.equal(w.card(1).querySelector("a"), null, "no card control leaves the app");
  assert.match(view.innerHTML, /<svg/);
  view.click();
  await w.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(w.calls)), [["get_home", { listing_id: "home-b" }]]);
  assert.ok(w.sheet()!.classList.contains("open"));
  assert.match(w.sheet()!.innerHTML, /home\.co\.uk/, "home.co.uk is still one click away inside the details");
});

test("focus stays in the sheet through the detail arriving or failing, the results behind are inert, and Esc returns to the card", async () => {
  for (const outcome of ["answer", "failure"] as const) {
    const answer = deferred();
    const w = widget(() => answer.promise);
    w.card(1).focus();
    w.key(w.card(1), "Enter");
    await w.settle();
    const sheet = w.sheet()!;
    assert.ok(w.document.activeElement?.matches("[data-back]"), `${outcome}: Back has focus once the sheet opens`);
    assert.ok(w.root.hasAttribute("inert") && w.root.getAttribute("aria-hidden") === "true", `${outcome}: the results behind are inert`);

    if (outcome === "answer") answer.resolve({ structuredContent: { id: "home-b", address: "2 Card Street", description: "The full description." } });
    else answer.reject(new Error("429"));
    await w.settle();
    assert.match(sheet.innerHTML, outcome === "answer" ? /The full description\./ : /data-retry/);
    assert.ok(w.document.activeElement?.matches("[data-back]"), `${outcome}: focus survives the sheet repainting`);

    // Tab and Shift+Tab cycle inside the sheet.
    const focusables = Array.from(sheet.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),[tabindex]:not([tabindex='-1'])"));
    const first = focusables[0]!, last = focusables[focusables.length - 1]!;
    assert.ok(focusables.length >= 2, `${outcome}: the sheet has at least Back and the home.co.uk link`);
    last.focus();
    assert.equal(w.key(last, "Tab").defaultPrevented, true);
    assert.equal(w.document.activeElement, first, `${outcome}: Tab from the last control wraps to the first`);
    assert.equal(w.key(first, "Tab", true).defaultPrevented, true);
    assert.equal(w.document.activeElement, last, `${outcome}: Shift+Tab from the first control wraps to the last`);

    w.key(w.document.activeElement!, "Escape");
    assert.equal(sheet.classList.contains("open"), false);
    assert.equal(w.root.hasAttribute("inert"), false, `${outcome}: the results are usable again`);
    assert.equal(w.document.activeElement, w.card(1), `${outcome}: focus returns to the card that opened the sheet`);
  }
});

test("closing the sheet returns the listings map to the camera the user had", async () => {
  const w = widget(async () => ({ structuredContent: { id: "home-a", description: "Full." } }));
  // The user has panned, zoomed and tilted to compare an area.
  Object.assign(w.camera, { center: { lng: -2.1, lat: 51.5 }, zoom: 13.4, pitch: 20, bearing: 7 });
  const before = JSON.parse(JSON.stringify(w.camera));
  (w.card(0) as HTMLElement).click();
  assert.deepEqual([w.camera.zoom, w.camera.pitch, w.camera.bearing], [16.6, 56, -20], "opening a home flies in to it");
  await w.settle();
  w.key(w.document.body, "Escape");
  assert.deepEqual(w.camera, before, "Back restores the user's own view, not the home's close-up");
  assert.deepEqual(w.moves.slice(-2), ["stop", "ease"], "any flight still running is stopped before easing back");
});

test("cards and the sheet slide through the listing's own photos, starting on the card's photo", async () => {
  const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
  const full = (n: number) => `https://cdn.home.co.uk/listings/home-a/images/${uuid(n)}.jpg`;
  const thumb = (n: number) => `https://cdn.home.co.uk/listings/home-a/images/thumbnails/${uuid(n)}.jpg`;
  const gallery = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ full: full(n), thumb: thumb(n) }));
  const answer = deferred();
  const w = widget(() => answer.promise, { "home/photos": { "home-a": gallery } });
  const media = w.card(0).querySelector(".media")!;
  const imgs = Array.from(media.querySelectorAll("img.photo")).map((img) => img.getAttribute("src"));
  assert.deepEqual(imgs, gallery.map((p) => p.thumb), "the card carries every photo as a thumbnail, in listing order");
  assert.equal(media.querySelector(".photo-count")?.textContent, "1 / 8", "more than six photos show a counter, not dots");
  const next = media.querySelector('[data-photo="1"]') as HTMLButtonElement;
  const prev = media.querySelector('[data-photo="-1"]') as HTMLButtonElement;
  assert.ok(next && prev, "the card photo has glass chevrons");
  next.click();
  assert.deepEqual(w.scrolls.at(-1), { cls: "photo-strip", left: 600 });
  prev.click(); prev.click();
  assert.deepEqual(w.scrolls.at(-1), { cls: "photo-strip", left: 7 * 600 }, "previous from the first photo wraps to the last");
  await w.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(w.calls)), [], "a chevron never opens the home");
  assert.equal(w.sheet()?.classList.contains("open") ?? false, false);

  // The sheet opens straight away on the card's photo with the whole gallery, before get_home answers.
  w.card(0).focus();
  w.key(w.card(0), "Enter");
  await w.settle();
  const hero = w.sheet()!.querySelector(".hero")!;
  assert.deepEqual(Array.from(hero.querySelectorAll("img")).map((img) => img.getAttribute("src")), gallery.map((p) => p.full));
  assert.equal(w.sheet()!.querySelector(".counter")?.textContent, "1 / 8");
  // get_home's own gallery arrives in another order; the sheet keeps the card's photo first.
  answer.resolve({ structuredContent: { id: "home-a", photos: [full(5), full(1), full(2)], description: "Full." } });
  await w.settle();
  assert.equal(w.sheet()!.querySelector(".hero img")!.getAttribute("src"), full(1));
  w.key(w.document.activeElement!, "ArrowRight");
  assert.deepEqual(w.scrolls.at(-1), { cls: "hero", left: 600 }, "the arrow keys move the gallery");
});

test("without the server's photos the sheet still starts on the card's photo", async () => {
  const at = (u: string) => `https://cdn.home.co.uk/listings/home-b/images/${u}.jpg`;
  const lead = "0000000c-0000-4000-8000-000000000000";
  // The card shows the listing's lead thumbnail; get_home lists the same photo second.
  const w = widget(async () => ({ structuredContent: { id: "home-b", photos: [at("0000000a-0000-4000-8000-000000000000"), at(lead), at("0000000d-0000-4000-8000-000000000000")] } }), undefined,
    { "home-b": `https://cdn.home.co.uk/listings/home-b/images/thumbnails/${lead}.jpg` });
  (w.card(1).querySelector("[data-open]") as HTMLButtonElement).click();
  await w.settle();
  assert.equal(w.sheet()!.querySelector(".hero img")!.getAttribute("src"), at(lead), "the full-size version of the card's photo leads");
  assert.equal(w.sheet()!.querySelector(".counter")?.textContent, "1 / 3", "the thumbnail is not counted twice");
});
