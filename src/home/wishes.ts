/**
 * Soft wishes ("a garden", "a quiet street") matched against a listing's own words.
 * Each wish's patterns run strongest first, and the first that matches gives the evidence.
 * A wish counts only when the listing states it: every match carries the phrase it
 * came from, and a wish the listing does not mention is reported as not stated,
 * never as absent. Patterns are deliberately narrow; a missed match is honest, a
 * false one is not.
 */

export const WISHES = ["garden", "off_road_parking", "quiet_street", "period_features", "open_plan", "home_office", "no_chain", "pet_friendly",
  "south_facing_garden", "garage", "large_plot", "balcony_or_terrace", "views", "waterside", "en_suite", "utility_room", "conservatory", "log_burner", "annexe", "cellar", "loft_conversion", "lift", "single_storey", "renovated", "needs_modernisation", "extension_potential", "solar_panels", "heat_pump", "ev_charging", "furnished", "unfurnished", "bills_included"] as const;
export type Wish = typeof WISHES[number];

export interface WishMatch { wish: Wish; evidence: string }

const PERIOD_ERAS = "victorian|edwardian|georgian|regency|tudor|elizabethan|jacobean|queen anne|arts and crafts";

const PATTERNS: Record<Wish, RegExp[]> = {
  garden: [/\bgardens?\b/gi],
  off_road_parking: [
    /\boff[- ](?:road|street) parking\b/gi,
    /\b(?:private|allocated|gated|secure|own|driveway) parking\b/gi,
    /\b(?:allocated|private|designated) (?:car )?parking (?:space|bay)s?\b/gi,
    /\bparking (?:for (?:one|two|three|four|several|\d+) (?:cars?|vehicles?)|space|bay)s?\b/gi,
    /\bdriveways?\b/gi,
    /\b(?:single|double|integral|integrated|detached|attached|tandem|own|private|a|the) garages?\b/gi,
    /\bgarage (?:parking|space)\b/gi,
    /\bcar ?ports?\b/gi,
  ],
  quiet_street: [
    /\bquiet(?:ly)? (?:\w+ ){0,2}(?:street|road|lane|close|cul[- ]de[- ]sac|crescent|avenue|cove|mews|terrace|location|position|setting|backwater|residential area|neighbourhood|turning)s?\b/gi,
    /\bpeaceful (?:\w+ ){0,2}(?:street|road|lane|close|cul[- ]de[- ]sac|location|position|residential (?:setting|area)|neighbourhood|turning)s?\b/gi,
    /\bcul[- ]de[- ]sacs?\b/gi,
    /\bno[- ]through[- ]road\b/gi,
  ],
  // Named features first; a period home with no feature named is the weaker evidence.
  period_features: [
    /\b(?:period|original|character) (?:features?|details?|fireplaces?|doors?|floorboards?|windows?|charm)\b/gi,
    /\bsash windows?\b/gi,
    /\bhigh ceilings?\b/gi,
    /\b(?:ornate )?cornic(?:e|ing)s?\b/gi,
    /\bceiling roses?\b/gi,
    /\bpicture rails?\b/gi,
    /\b(?:original|cast[- ]iron|period|marble) (?:\w+ )?fireplaces?\b/gi,
    /\bexposed (?:\w+ )?beams?\b/gi,
    /\bstained[- ]glass\b/gi,
    /\bgrade (?:i{1,2}\*?|1|2\*?) listed\b/gi,
    new RegExp(`\\b(?:${PERIOD_ERAS}) features?\\b`, "gi"),
    /\b(?:period|character) (?:property|home|house|cottage|townhouse|building|conversion)\b/gi,
    new RegExp(`\\b(?:${PERIOD_ERAS}) (?:property|home|house|terrace|terraced (?:house|home|property)|townhouse|town house|cottage|villa|conversion|building|semi)\\b`, "gi"),
  ],
  open_plan: [
    /\bopen[- ]plan\b/gi,
    /\bbroken[- ]plan\b/gi,
    /\b(?:kitchen|living)(?:\s*[/,&-]\s*|\s+and\s+|\s+)(?:dining|living|family|kitchen|diner)(?:\s*[/,&-]\s*|\s+and\s+|\s+)(?:living|dining|family|kitchen|lounge)(?: room| area| space)?\b/gi,
    /\bkitchen[/ -](?:family|living) (?:room|area|space)\b/gi,
  ],
  home_office: [
    /\b(?:home|garden) offices?\b/gi,
    /\b(?:garden|home) (?:studio|room) (?:or|\/) office\b/gi,
    /\boffice (?:space|room|area)\b/gi,
    /\bwork(?:ing)? from home\b/gi,
    /\bhome[- ]working\b/gi,
    /\b(?:a|the|separate|useful|private|dedicated|small|spacious|large|ground[- ]floor|first[- ]floor) study\b/gi,
    /\bstudy(?: area| room|\s*\/\s*(?:bedroom|nursery|office|snug)|\s+or\s+(?:bedroom|nursery|office))\b/gi,
    /\b(?:bedroom(?: \w+)?|nursery)\s*(?:\/|or)\s*(?:study|office)\b/gi,
  ],
  no_chain: [
    /\bno (?:onward |forward |upward |further )?chain\b/gi,
    /\bchain[- ]free\b/gi,
    /\bvacant possession\b/gi,
  ],
  // Only a listing that says pets may come: "no pets" and "pets not considered" never match.
  pet_friendly: [
    /\bpets? (?:are |will be )?(?:considered|welcome|welcomed|allowed|accepted|permitted|negotiable|on request)\b/gi,
    /\bpet[- ]friendly\b/gi,
    /\b(?:small |one |a |well[- ]behaved )?(?:dogs?|cats?) (?:are |will be )?(?:considered|welcome|allowed|accepted|permitted)\b/gi,
  ],
  south_facing_garden: [
    /\b(?:south|south[- ]?west|south[- ]?east|southerly)[- ]facing (?:\w+ ){0,2}gardens?\b/gi,
    /\bgardens? (?:\w+ ){0,3}(?:is |are |which is |that is |enjoys? an? )?(?:south|south[- ]?west|south[- ]?east|southerly)[- ]facing\b/gi,
    /\bgardens? (?:\w+ ){0,2}(?:enjoy(?:s|ing)? )?(?:a |an )?(?:south|south[- ]?west|south[- ]?east|southerly) aspect\b/gi,
  ],
  garage: [
    /\b(?:single|double|triple|integral|integrated|detached|attached|tandem|own|private|large|separate|a|the) (?:\w+ )?garages?\b/gi,
    /\bgarage (?:block|space|parking|en bloc)\b/gi,
    /\bgaraging\b/gi,
  ],
  large_plot: [
    /\b(?:approximately |about |around |circa |c\. ?|nearly |almost |over |just over |just under |some )?\d+(?:\.\d+)? (?:of an )?acres?\b/gi,
    /\b(?:half|quarter|third) (?:of )?an acre\b/gi,
    /\bpaddocks?\b/gi,
    /\b(?:large|generous|substantial|good[- ]sized|sizeable|wide|extensive|mature) (?:plot|grounds)\b/gi,
    /\bstanding in (?:\w+ ){0,2}grounds\b/gi,
  ],
  balcony_or_terrace: [
    /\b(?:private |own |south[- ]facing |west[- ]facing |large |sunny |covered |wraparound |wrap[- ]around |generous )?balcon(?:y|ies)\b/gi,
    /\broof terraces?\b/gi,
    /\b(?:private|sun|decked|rooftop|outdoor) terraces?\b/gi,
  ],
  views: [
    /\b(?:sea|coastal|river|countryside|rural|open|far[- ]reaching|panoramic|uninterrupted|field|valley|estuary|harbour|lake|woodland|cathedral|city[- ]?scape|hill|downland|moorland|marina|canal) views?\b/gi,
    /\bviews? (?:over|across|of) (?:the )?(?:sea|river|countryside|fields|valley|estuary|harbour|lake|woodland|city|surrounding countryside|open countryside|downs|moors|park|parkland)\b/gi,
  ],
  // Only phrases that put the home itself on the water; "riverside walks" and "near the seafront" are the town.
  waterside: [
    /\b(?:on|right on|directly on|fronting) the (?:seafront|sea front|waterfront|water's edge|riverbank|river bank|quayside|harbour ?side)\b/gi,
    /\b(?:directly )?overlook(?:s|ing)? (?:the )?(?:river|sea|lake|canal|harbour|marina|estuary|water|beach|broads?)\b/gi,
    /\b(?:river|canal|lake|water|sea) frontage\b/gi,
    /\b(?:private |own |residents'? )moorings?\b/gi,
    /\b(?:backs|backing) (?:directly )?on ?to (?:the )?(?:river|canal|lake|sea|beach|water|broads?)\b/gi,
    /\b(?:direct|private) (?:beach|river|water|lake) access\b/gi,
    /\b(?:waterside|waterfront|riverside|lakeside|canalside|seafront|beachfront) (?:apartment|flat|home|house|property|cottage|bungalow|villa|penthouse|location|setting|position|plot)s?\b/gi,
  ],
  en_suite: [/\ben[- ]?suites?\b/gi],
  utility_room: [/\butility (?:room|area|space)s?\b/gi, /\bboot rooms?\b/gi],
  conservatory: [/\bconservator(?:y|ies)\b/gi, /\borangeries\b|\borangery\b/gi],
  log_burner: [
    /\b(?:log|wood)[- ]?burn(?:er|ing stove)s?\b/gi,
    /\bmulti[- ]?fuel (?:burner|stove)s?\b/gi,
    /\b(?:wood|log) (?:stove|fire)s?\b/gi,
    /\binglenook\b/gi,
    /\b(?:open|working) fire(?:place)?s?\b/gi,
  ],
  annexe: [
    /\bannexe?s?\b/gi,
    /\bgranny (?:flat|annexe?)\b/gi,
    /\bself[- ]contained (?:annexe?|apartment|flat|studio|cottage|accommodation|guest (?:suite|accommodation))\b/gi,
  ],
  cellar: [/\bcellars?\b/gi, /\bbasements?\b/gi],
  loft_conversion: [/\bloft conversion\b/gi, /\bconverted (?:loft|attic)\b/gi, /\b(?:loft|attic) (?:room|bedroom|conversion|suite)s?\b/gi],
  lift: [
    /\b(?:passenger|communal|residents'?) lifts?\b/gi,
    /\blifts? (?:to all floors|to every floor|serv(?:es|ing)|access)\b/gi,
    /\b(?:served by|with|benefits from) (?:a |the )?lift\b/gi,
  ],
  single_storey: [/\bbungalows?\b/gi, /\bsingle[- ]stor(?:e)?y\b/gi, /\ball on one (?:level|floor)\b/gi, /\bon one level\b/gi],
  renovated: [
    /\b(?:newly|recently|fully|completely|extensively|beautifully|sympathetically|tastefully|thoughtfully|lovingly|meticulously|stylishly) (?:renovated|refurbished|modernised|modernized|redecorated|restored|remodelled|remodeled|updated|upgraded)\b/gi,
    /\bready to move (?:straight )?in(?:to)?\b/gi,
    /\bwalk[- ]in condition\b/gi,
    /\bturn[- ]?key\b/gi,
  ],
  needs_modernisation: [
    /\b(?:in need of|requir(?:es|ing)|would benefit from|needs?|benefit(?:s|ing)? from) (?:\w+ ){0,2}(?:modernisation|modernization|updating|refurbishment|renovation|improvement|tlc)\b/gi,
    /\b(?:renovation|refurbishment|modernisation|restoration) (?:project|opportunity)\b/gi,
    /\bdoer[- ]upper\b/gi,
  ],
  extension_potential: [
    /\b(?:potential|scope|room|opportunity|space) (?:to|for) (?:\w+ ){0,2}(?:extend|extension|extensions|convert the loft|loft conversion|develop|redevelop)\b/gi,
    /\bextension potential\b/gi,
    /\b(?:stpp|subject to (?:the )?(?:necessary )?planning(?: permission| consents?)?)\b/gi,
    /\bplanning (?:permission|consent) (?:granted|approved|in place)\b/gi,
  ],
  solar_panels: [/\bsolar (?:panels?|pv|photovoltaic|array|power|tiles)\b/gi, /\bphotovoltaic\b/gi],
  heat_pump: [/\b(?:air|ground)[- ]source heat pumps?\b/gi, /\bheat pumps?\b/gi],
  ev_charging: [/\b(?:ev|electric (?:vehicle|car)|car) charg(?:er|ing)(?: points?| ports?| stations?)?s?\b/gi],
  furnished: [/\b(?:fully |part(?:ly|ially)? |newly |tastefully |beautifully |well )?furnished\b/gi],
  unfurnished: [/\bunfurnished\b/gi],
  bills_included: [
    /\b(?:all )?bills (?:are )?included\b/gi,
    /\binclusive of (?:all )?bills\b/gi,
    /\bbills inclusive\b/gi,
    /\b(?:all )?(?:utilities|utility bills) (?:are )?included\b/gi,
  ],
};

/** A matched word is ruled out when its own clause negates it just before. */
const NEGATION = /\b(?:no|not|without|lacks?|lacking|nor|isn't|doesn't|there's no|there is no)\b(?:\s+\S+){0,2}\s*$/i;

/**
 * The clause goes on to deny what it named: "off-road parking is not available",
 * "vacant possession will not be given". Only a denial of the thing itself counts,
 * so "a garden which is not overlooked" still states a garden.
 */
const DENIED_AFTER = /^\s*(?:\w+\s+){0,2}?(?:(?:is|are|was|will be|would be|can be|cannot be|can't be|won't be)\s+(?:not\s+|no longer\s+)?(?:unavailable|available|included|offered|provided|given|possible|guaranteed)|isn't available|aren't available|not (?:available|included|offered|provided|given|possible|guaranteed))\b/i;
/** For the chain phrases a bare negation after them is enough: "vacant possession is not", "chain free it is not". */
const CHAIN_DENIED_AFTER = /^\s*(?:\w+\s+){0,2}?(?:is|are|was|will|would|can|could|shall)?\s*(?:not|never|no longer|isn't|won't|cannot|can't)\b/i;

/**
 * A clause that only offers the feature as a possibility ("could be used as a home
 * office", "potential for off-road parking") does not state it.
 */
/** Wishes whose own phrasing is a hedge ("potential to extend", "would benefit from"). */
const HEDGED_WISHES: ReadonlySet<Wish> = new Set<Wish>(["extension_potential", "needs_modernisation"]);

const HEDGE = /\b(?:could|would|might|may|can be|potential(?:ly)?|possib(?:le|ly|ility)|scope|subject to|options? (?:to|for)|ideal(?:ly)? (?:for|as)|suit(?:s|able|ed)?|lend themselves|if required|flexib\w*|versatil\w*|adapt\w*|serve as|use as|used as)\b/i;

/** Proper names and other senses that only look like the feature. */
const FALSE_SENSES: Partial<Record<Wish, (before: string, match: string, after: string) => boolean>> = {
  garden: (before, match, after) => {
    if (/^\s*(?:centres?|centers?|city|suburb|village|square|party|furniture|waste|bridge|flat|apartment|maisonette|room|studio|office|level|floor|shed|building|cabin|details)\b/i.test(after)) return true;
    if (/\b(?:covent|botanic(?:al)?|kew|hatton|welwyn|letchworth|queen's|king's|royal|public|community|nearby|local)\s*$/i.test(before)) return true;
    if (/\b(?:overlook(?:s|ing)?|views? (?:of|over|across)|close to|near(?:by)?|walk (?:to|from)|opposite|backs? onto|next to|minutes from)\s+(?:the\s+)?(?:\S+\s+){0,2}$/i.test(before)) return true;
    // "Sydney Gardens", "Victoria Garden Road": a capitalised name, not this home's garden.
    const previous = before.match(/([A-Za-z'’]+)\s*$/)?.[1] ?? "";
    const qualifier = /^(?:rear|front|back|side|private|enclosed|landscaped|walled|lawned|cottage|communal|courtyard|roof|south|north|east|west|facing|large|mature|secluded|sunny|own|level|tiered|terraced|wraparound|wrap|good|generous|delightful|beautiful|lovely|pretty|established|low|maintenance|the|a|and|with|to|of)$/i;
    if (/^[A-Z]/.test(match) && /^[A-Z]/.test(previous) && !qualifier.test(previous)) return true;
    if (/^\s+(?:road|street|lane|avenue|close|place|grove|terrace|walk|way|drive)\b/i.test(after) && /^[A-Z]/.test(match)) return true;
    return false;
  },
  off_road_parking: (before, match, after) =>
    /\bgarage/i.test(match) && (/\b(?:converted|former|old)\b/i.test(match) || /\b(?:converted|former|old)\s+(?:\S+\s+)?$/i.test(before) || /^\s*(?:conversion|converted|has been converted|now)\b/i.test(after)),
  // About the area, not the home: "pet-friendly park", "pet friendly cafes nearby".
  pet_friendly: (_before, _match, after) => /^\s*(?:park|parks|area|neighbourhood|walks?|trails?|cafes?|pubs?|beach|beaches|community|village|town)\b/i.test(after),
  // Nearness or a name, not a home on the water: "moments from the seafront", "Trinity Riverside development".
  waterside: (before, match, after) =>
    /\b(?:drinks?|bars?|caf(?:e|é)s?|pubs?|restaurants?|promenade|stroll|dog walks?|evening|afternoon)\b/i.test(before) ||
    /\b(?:from|to|of|near|nearby|close to|walk(?:ing)?|stroll|minutes?|moments?|short distance|reach|towards|along)\s+(?:\w+\s+){0,2}$/i.test(before) ||
    (/^[A-Z]/.test(match) && /[A-Z][\w']*\s*$/.test(before)) || /^\s*(?:development|road|street|walk|way|drive|court|house|park|centre)\b/i.test(after),
  // "Rather than simply an annexe to the main house" describes, it does not offer one.
  annexe: (before) => /\bthan\s+(?:simply\s+|just\s+|merely\s+)?(?:an?\s+)?$/i.test(before),
  // Ready for, or space for, panels is not panels.
  solar_panels: (before) => /\b(?:ready|suitable|space|room|potential|provision|prepared|wired|scope)\s+for\s+(?:\S+\s+){0,2}$/i.test(before) || /\bextension\/$/i.test(before),
  // A converted garage is a room now; "garage sale" and a garage door alone are not a garage.
  garage: (before, match, after) =>
    /\b(?:converted|former|old)\b/i.test(match) ||
    /\b(?:converted|former|old)\s+(?:\S+\s+)?$/i.test(before) || /^\s*(?:conversion|converted|has been converted|now|sale|door)\b/i.test(after),
  // A Juliet balcony is a railing at a window, not outdoor space.
  balcony_or_terrace: (before, match) => /\bjuliet(?:te)?\s*$/i.test(before) || /^juliet/i.test(match),
  // "Basement flat" in a building with others is fine; a basement car park is not a cellar.
  cellar: (_before, _match, after) => /^\s*(?:car park|parking|garage|flat|apartment|maisonette|studio)\b/i.test(after),
  // "No onward chain" style: never count a furnished word that is the "un" of unfurnished.
  furnished: (before) => /\bun$/i.test(before),
  // Planning words only count when they are about this home, not the area.
  extension_potential: (before) => /\b(?:nearby|neighbouring|surrounding|area|village)\b/i.test(before),
  no_chain: (before, _match, after) => /^[-\s]*move\b/i.test(after) || /\bpart[- ]exchange|guaranteed buyer/i.test(before),
  period_features: (before, _match, after) =>
    /^\s*(?:-?style|style|inspired|replica|reproduction)\b/i.test(after) || /\b(?:grounds|park|church|surrounding|nearby|neighbouring|area)\b/i.test(before),
};

/**
 * Where a sentence (or, with commas and colons, a clause) breaks. A full stop or
 * question mark breaks only before a space, so "0.5 miles" and a mis-encoded
 * "d?cor" stay whole.
 */
const SENTENCE_BREAK = /[.!?;](?=\s|$)|[\n•|]/g;
const CLAUSE_BREAK = /[.!?;,:](?=\s|$)|[\n•|]/g;

function lastBreak(text: string, index: number, pattern: RegExp): number {
  let found = -1;
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m && m.index < index; m = pattern.exec(text)) found = m.index;
  return found + 1;
}

function nextBreak(text: string, index: number, pattern: RegExp): number {
  pattern.lastIndex = index;
  return pattern.exec(text)?.index ?? text.length;
}

const clauseStart = (text: string, index: number) => lastBreak(text, index, CLAUSE_BREAK);

function sentenceOf(text: string, start: number, end: number): string {
  return text.slice(lastBreak(text, start, SENTENCE_BREAK), nextBreak(text, end, SENTENCE_BREAK));
}

/**
 * The short phrase a match came from: its sentence, cut to about `max` characters
 * around the match at word boundaries. Always an exact substring of the listing.
 */
export function evidencePhrase(text: string, start: number, end: number, max = 120): string {
  const sentenceStart = lastBreak(text, start, SENTENCE_BREAK);
  const sentenceEnd = nextBreak(text, end, SENTENCE_BREAK);
  let from = sentenceStart; let to = sentenceEnd;
  if (to - from > max) {
    const room = Math.max(0, max - (end - start));
    from = Math.max(from, start - Math.floor(room / 2));
    to = Math.min(to, end + (room - (start - from)));
    // Widen to whole words.
    while (from > sentenceStart && /\S/.test(text[from - 1]!)) from--;
    while (to < sentenceEnd && /\S/.test(text[to]!)) to++;
  }
  return text.slice(from, to).trim().replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, "");
}

/** The first statement of each wish in a listing's text, with its own phrase as evidence. */
export function matchWishes(text: string | null, wishes: readonly Wish[]): WishMatch[] {
  if (!text) return [];
  const found: WishMatch[] = [];
  for (const wish of wishes) {
    let first: { start: number; end: number } | null = null;
    for (const pattern of PATTERNS[wish]) {
      pattern.lastIndex = 0;
      for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
        const start = m.index; const end = start + m[0].length;
        const before = text.slice(clauseStart(text, start), start);
        // "No onward chain" carries its own "no"; every other phrase, "chain free" and
        // "vacant possession" included, is ruled out by a negation before it.
        if (!/^no\b/i.test(m[0]) && NEGATION.test(before)) continue;
        const rest = text.slice(end, nextBreak(text, end, CLAUSE_BREAK));
        if (DENIED_AFTER.test(rest) && /\b(?:not|no longer|unavailable|isn't|aren't|cannot|can't|won't)\b/i.test(rest)) continue;
        if (wish === "no_chain" && !/^no\b/i.test(m[0]) && CHAIN_DENIED_AFTER.test(rest)) continue;
        if (!HEDGED_WISHES.has(wish) && HEDGE.test(before)) continue;
        // A spare room offered as "bedroom, nursery or home office" is a choice, not an office.
        if (wish === "home_office" && (HEDGE.test(sentenceOf(text, start, end)) || /\bor\b/i.test(sentenceOf(text, start, end)))) continue;
        if (FALSE_SENSES[wish]?.(before, m[0], text.slice(end, end + 40))) continue;
        first = { start, end };
        break;
      }
      if (first) break;
    }
    if (first) found.push({ wish, evidence: evidencePhrase(text, first.start, first.end) });
  }
  return found;
}
