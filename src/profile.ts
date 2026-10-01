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
  /**
   * What a call answers when the API refuses it for a low balance (HTTP 402),
   * in place of the API's own body. Absent: the API's body is passed through.
   */
  lowBalanceAnswer?: Readonly<Record<string, string>>;
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
  "It does not value homes, search homes for sale, or say who owns or lives at an address.",
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
 * ChatGPT wording for every exposed tool. The catalogue text is written for the
 * full tool set (it points at council_tax_full and the Base tier, found by
 * ChatGPT's Plugin Creator on 2026-10-01) and for developers, so ChatGPT gets
 * its own: what the tool answers, then a "Use this when" line in the words
 * people type (house, home, flat, area, neighbourhood), then any limit the
 * model must state. Name only what the tool returns; valuations and homes for
 * sale appear only as limits.
 */
export const CHATGPT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  address_find:
    "Find a UK address and its UPRN (Unique Property Reference Number) from what the user typed: a full or partial " +
    "address, a building name, a postcode or a place. Every property tool takes the UPRN this returns. " +
    "Use this when someone names a house, home, flat, building or street and you need to identify the property " +
    "before answering anything about it. United Kingdom only.",
  address_postcode:
    "List every registered address at one UK postcode, with the UPRN for each. " +
    "Use this when someone asks which houses, flats or buildings are at a postcode, or gives only a postcode and " +
    "needs to pick their home from the list.",
  property_core:
    "The full picture of one property in a single call: address, rooms, EPC rating, last sale, construction, " +
    "dimensions, garden, parking and title basics, plus council tax band, flood risk, schools, broadband, crime, " +
    "demographics, solar potential, confirmed sales and planning constraints. " +
    "Use this when someone wants an overview of, or background on, a house, flat or home they are buying, renting " +
    "or researching, rather than calling several smaller tools. It does not value the property.",
  attr_epc:
    "Energy Performance Certificate (EPC) headline for a property: current and potential energy efficiency rating, " +
    "EPC floor area and the date of the last assessment. " +
    "Use this when someone asks how energy efficient a house or flat is, what its energy rating or EPC band is, " +
    "or when it was last assessed.",
  council_tax:
    "Council tax band for a property, with the billing authority name and its official code. " +
    "Use this when someone asks which council tax band a house, flat or home is in, or which council it pays. " +
    "It gives the band, not the yearly or monthly charge in pounds.",
  risks:
    "Environmental risk screening for one property: flood, radon, noise, landfill, coal and other mining, invasive " +
    "plants and air quality. Ask for one hazard, or for all of them in a single response. " +
    "Use this when someone asks whether a house, flat or home is at risk of flooding or in a flood zone, about " +
    "radon, noise, landfill or mining nearby, or wants every environmental check for the property.",
  planning:
    "Planning applications near a postcode or coordinates: type, status, description and decision date, with " +
    "filters for recency, type and status. By default it covers the last 90 days within 0.5 km; it reaches up to " +
    "365 days and 5 km. " +
    "Use this when someone asks about planning permission, extensions, building work or new developments near a " +
    "house, street, area or neighbourhood.",
  schools:
    "Schools near a postcode, with Ofsted rating, phase, pupil numbers and distance, from the Department for " +
    "Education register. " +
    "Use this when someone asks about good schools, primary or secondary schools, or Ofsted ratings near a home, " +
    "postcode or neighbourhood. It lists schools by distance, not by admission catchment. England only: for a " +
    "postcode elsewhere say the data covers England only, never that there are no schools.",
  broadband:
    "Broadband availability at a postcode: average and maximum download and upload speeds, superfast, ultrafast, " +
    "gigabit and full-fibre coverage, and how many premises are covered. From Ofcom Connected Nations. " +
    "Use this when someone asks how fast the internet or broadband is at a home or postcode, or whether fibre or " +
    "full fibre is available. Figures cover the postcode, not one line.",
  crime:
    "Recorded crime near a postcode or coordinates, by category and month, from Police UK. " +
    "Use this when someone asks how safe an area or neighbourhood is, or about crime rates, burglary or " +
    "anti-social behaviour near a house, flat or street. Report the figures; do not call a place safe or unsafe " +
    "on your own authority.",
  price_trends:
    "Average property prices over time for an outcode, the first half of a postcode such as SW1A or M1. " +
    "Use this when someone asks how house prices or average prices in a town, area or neighbourhood have moved " +
    "over time. It gives area averages, not the value of any one home.",
  price_growth:
    "Capital growth for an outcode area: annual growth rate, returns over one, three, five and ten years, and a " +
    "historical price index, from Land Registry sold prices. " +
    "Use this when someone asks whether house prices in an area have gone up or down, or by how much over a number " +
    "of years. It gives area figures, not the value of any one home.",
  deprivation:
    "Index of Multiple Deprivation scores for a postcode, across income, employment, education, health, crime, " +
    "housing and environment. " +
    "Use this when someone asks how deprived or well-off an area or neighbourhood is, or about local income, " +
    "employment or health. England only: say so for postcodes in Scotland, Wales or Northern Ireland.",
  amenities_all:
    "Every amenity group near a property in one response: food, education, healthcare, financial, civic, worship, " +
    "culture, convenience, green spaces, transport and shops. " +
    "Use this when someone asks what is near a house, flat or home: shops, cafes, restaurants, parks, doctors, " +
    "banks, places of worship, stations or other local amenities in the neighbourhood.",
};

/**
 * ChatGPT's answer to a call the API refused for a low balance. The API's own
 * 402 body states the price, the balance and a link to the billing page that
 * starts a purchase ("Top up at .../subscription", plus required, available and
 * topup_url). OpenAI forbids selling tokens or credits in ChatGPT "whether
 * offered directly or indirectly", so this answer says only that the lookup is
 * unavailable to the connected account: it names no credits, price, amount or
 * link, and never tells the user to buy, add or top up anything.
 */
export const CHATGPT_LOW_BALANCE_ANSWER = {
  error: "lookup_unavailable",
  message:
    "Homedata cannot run this lookup for the connected account right now. " +
    "The account holder can check the Homedata account, then try again.",
} as const;

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
    lowBalanceAnswer: CHATGPT_LOW_BALANCE_ANSWER,
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
