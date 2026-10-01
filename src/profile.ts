/**
 * Tool surface profiles.
 *
 * The stdio package and the remote ChatGPT endpoint share one tool definition
 * (the vendored manifest) but present it differently:
 *
 * - `stdio`: every catalogue tool, descriptions with their token prices, and the
 *   two signup helpers. Unchanged from the published package.
 * - `chatgpt`: OpenAI's plugin guidelines forbid advertising pricing and selling
 *   credits inside ChatGPT, and require a title and explicit read-only,
 *   destructive and open-world annotations on every tool. So: no prices in any
 *   model-readable text (spend still reaches `_meta`, which the model never
 *   sees), no signup helpers, and a curated set of tools chosen from user goals
 *   rather than a mirror of every endpoint.
 *   See docs/chatgpt-app/RESEARCH.md.
 */
export interface Profile {
  name: "stdio" | "chatgpt";
  /** Catalogue tool names to expose, or "all". */
  tools: readonly string[] | "all";
  /** Keep the "Costs N tokens" sentence in descriptions. */
  prices: boolean;
  /** List start_homedata_signup and check_homedata_api_key. */
  signupHelpers: boolean;
  /** Add title, annotations and securitySchemes to every tool. */
  chatgptMetadata: boolean;
  /**
   * Descriptions that replace the catalogue text for this profile. The
   * catalogue is written for the full tool set; where it points at a tool or
   * tier this profile does not expose, the model is sent somewhere it cannot go.
   */
  descriptions?: Readonly<Record<string, string>>;
  instructions: string;
}

const STDIO_INSTRUCTIONS = [
  "Homedata answers questions about UK property: addresses and UPRNs, EPC, council tax, sale history,",
  "planning, environmental risk, schools, broadband, crime, local amenities and area statistics.",
  "",
  "Start with `address_find` to turn an address into a UPRN, then use the UPRN tools. Postcode and",
  "outcode tools cover the surrounding area.",
  "",
  "For a whole property, prefer one tier call over many small ones: `property_base` for the basics,",
  "`property_core` for the usual full picture, `property_complete` for everything. `property_discovery`",
  "costs 1 token and shows what a property has before you commit.",
  "",
  "Calls are paid for in tokens from a prepaid balance. Each tool's description states its price, and a",
  "call reports what it actually cost in its `homedata.tokens_charged` metadata.",
].join("\n");

// The first 512 characters carry the sequence the model must follow (OpenAI:
// "Keep the most important details in the first 512 characters").
const CHATGPT_INSTRUCTIONS = [
  "Homedata answers questions about specific UK properties and the areas around them.",
  "Always start with `address_find` to turn the address the user gives into a UPRN, then pass that UPRN",
  "to the property tools. For a whole-property question call `property_core` once rather than many small",
  "tools. Coverage is the United Kingdom only; say so plainly for addresses elsewhere.",
  "Postcode and outcode tools cover the surrounding area: for what an area is like to live in, call",
  "`deprivation`, `crime`, `schools` and `broadband` for the postcode.",
].join("\n");

/**
 * The first ChatGPT tool set, picked from the goals people bring to a property
 * conversation: find the address, the whole picture, and the questions asked
 * on their own (EPC, council tax, flood and other risks, planning, schools,
 * broadband, crime, prices in the area, what the area is like).
 *
 * `postcode_profile` is left out: measured in production on 2026-10-01 it
 * returned empty deprivation, school and transport sections (and often empty
 * broadband and sold prices) for every postcode tried, while its description
 * promises all of them. An area question is answered from the dedicated tools
 * instead. Add it back here once the profile returns full data.
 */
export const CHATGPT_TOOLS = [
  "address_find",
  "address_postcode",
  "property_core",
  "attr_epc",
  "council_tax",
  "risks",
  "planning",
  "schools",
  "broadband",
  "crime",
  "price_trends",
  "price_growth",
  "deprivation",
  "amenities_all",
] as const;

/**
 * ChatGPT wording for catalogue descriptions that reference tools outside
 * CHATGPT_TOOLS (council_tax_full) or tiers it does not expose (Base). Found by
 * ChatGPT's Plugin Creator against the live endpoint, 2026-10-01.
 */
export const CHATGPT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  property_core:
    "The full picture of one property in a single call: address, rooms, EPC rating, last sale, construction, " +
    "dimensions, garden, parking and title basics, plus council tax band, flood risk, schools, broadband, crime, " +
    "demographics, solar potential, confirmed sales and planning constraints. Use it for a whole-property question " +
    "rather than calling several smaller tools.",
  council_tax:
    "Council tax band for a property, with the billing authority name and its official code. It gives the band, " +
    "not the yearly or monthly charge in pounds.",
};

export const PROFILES: Record<Profile["name"], Profile> = {
  stdio: {
    name: "stdio",
    tools: "all",
    prices: true,
    signupHelpers: true,
    chatgptMetadata: false,
    instructions: STDIO_INSTRUCTIONS,
  },
  chatgpt: {
    name: "chatgpt",
    tools: CHATGPT_TOOLS,
    prices: false,
    signupHelpers: false,
    chatgptMetadata: true,
    descriptions: CHATGPT_DESCRIPTIONS,
    instructions: CHATGPT_INSTRUCTIONS,
  },
};

/**
 * Sentences about what a call costs us to serve: the price ("Costs 2 tokens.")
 * and relative-price advice ("Cheaper than calling those tools separately.").
 * "Cost" alone is NOT matched: renovation and mortgage tools describe costs the
 * user asked about, which is subject matter, not our pricing.
 */
const PRICE_SENTENCE = /\btokens?\b|\bcheap(?:er|est)?\b|\bCosts \d/i;

/**
 * Drop every pricing sentence from a description. Sentences end at ". " (the
 * catalogue writes plain sentences; none abbreviates with a full stop).
 */
export function withoutPrice(description: string): string {
  return description
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !PRICE_SENTENCE.test(sentence))
    .join(" ")
    .trim();
}
