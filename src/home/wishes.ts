/**
 * Soft wishes ("a garden", "a quiet street") matched against a listing's own words.
 * Each wish's patterns run strongest first, and the first that matches gives the evidence.
 * A wish counts only when the listing states it: every match carries the phrase it
 * came from, and a wish the listing does not mention is reported as not stated,
 * never as absent. Patterns are deliberately narrow; a missed match is honest, a
 * false one is not.
 */

export const WISHES = ["garden", "off_road_parking", "quiet_street", "period_features", "open_plan", "home_office", "no_chain"] as const;
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
    /\bgarage/i.test(match) && (/\b(?:converted|former|old)\s+(?:\S+\s+)?$/i.test(before) || /^\s*(?:conversion|converted|has been converted|now)\b/i.test(after)),
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
        if (HEDGE.test(before)) continue;
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
