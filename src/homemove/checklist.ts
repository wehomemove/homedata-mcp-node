/**
 * A UK moving checklist: what to do and who to tell, by when, for the user's situation.
 * Fixed guidance, not advice; each step Homemove can price names the service so the model
 * can offer a quote. Dates are worked back from the move date when one is given.
 */
export type ChecklistSituation = "buying" | "selling" | "buying_and_selling" | "renting" | "landlord";

export interface ChecklistItem { task: string; detail: string; service?: string }
export interface ChecklistStage { when: string; weeks_before: number | null; date?: string; items: ChecklistItem[] }

const BUYING: ChecklistItem[] = [
  { task: "Instruct a conveyancer", detail: "They handle searches, contracts and the transfer once your offer is accepted.", service: "conveyancing buying" },
  { task: "Book a survey", detail: "A Level 2 suits most homes in normal condition; a Level 3 suits older, altered or troubled ones.", service: "Level 2 survey" },
  { task: "Line up your mortgage offer", detail: "Your lender's valuation and offer need to be in place before exchange." },
];
const SELLING: ChecklistItem[] = [
  { task: "Get an EPC", detail: "You need a valid Energy Performance Certificate before you market the home.", service: "EPC" },
  { task: "Choose an estate agent", detail: "Compare fees, local sales and how they will market the home.", service: "estate agent" },
  { task: "Instruct a conveyancer for the sale", detail: "They prepare the contract pack and deal with the buyer's solicitor.", service: "conveyancing selling" },
];
const LANDLORD: ChecklistItem[] = [
  { task: "Get an EPC", detail: "A let home needs a valid EPC, rated E or above in England and Wales.", service: "EPC" },
  { task: "Book the gas safety check", detail: "A Gas Safe engineer's certificate every year, given to the tenant.", service: "gas safety certificate" },
  { task: "Book the electrical inspection (EICR)", detail: "At least every five years in England, with a copy to the tenant.", service: "EICR" },
  { task: "Protect the deposit", detail: "In a government-backed scheme within 30 days of receiving it." },
];

/** Who to tell and what to arrange, common to every move. */
const EVERY_MOVE: Array<[number | null, string, ChecklistItem[]]> = [
  [8, "6 to 8 weeks before", [
    { task: "Book removals or a man and van", detail: "Good firms book up, especially at month ends and Fridays.", service: "removals" },
    { task: "Sort out what you're not taking", detail: "Sell, donate or book a tip run now; less to move costs less." },
  ]],
  [4, "4 weeks before", [
    { task: "Arrange broadband at the new home", detail: "Installs can take two weeks or more.", service: "broadband" },
    { task: "Set up Royal Mail redirection", detail: "Catches post you forget to update, for 3 to 12 months." },
    { task: "Order packing boxes and materials", detail: "Start with rooms you use least.", service: "packing boxes" },
  ]],
  [2, "2 weeks before", [
    { task: "Tell your council", detail: "Council tax for both homes, and register to vote at the new address." },
    { task: "Tell your energy and water suppliers", detail: "Give your moving date; you'll take final readings on the day." },
    { task: "Update your bank, employer, HMRC and pension", detail: "Change your address with each." },
    { task: "Update the DVLA", detail: "Your driving licence and car's V5C logbook, free online." },
    { task: "Tell your insurers", detail: "Home, contents, car and pet insurance all depend on your address.", service: "home insurance" },
  ]],
  [1, "The week before", [
    { task: "Book the moving-out clean", detail: "For a rental, it helps get your deposit back.", service: "end of tenancy clean" },
    { task: "Confirm times with removers and your conveyancer", detail: "Check where to collect the keys." },
    { task: "Pack an essentials box", detail: "Kettle, chargers, toiletries, documents, bedding for night one." },
  ]],
  [0, "Moving day", [
    { task: "Take meter readings at both homes", detail: "Gas, electricity and water, with photos." },
    { task: "Leave keys and manuals for the next occupant", detail: "Note where the stopcock and meters are." },
  ]],
  [null, "After you move", [
    { task: "Register with a GP and dentist", detail: "Update your NHS address." },
    { task: "Update the TV licence and any subscriptions", detail: "Deliveries too." },
    { task: "Check the council tax band", detail: "Each home has a band that sets the bill.", service: "council tax" },
  ]],
];

function minus(date: string, weeks: number): string | undefined {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  return d.toISOString().slice(0, 10);
}

export function movingChecklist(situation: ChecklistSituation, moveDate?: string): ChecklistStage[] {
  const start: ChecklistItem[] = [
    ...(situation === "selling" || situation === "buying_and_selling" ? SELLING : []),
    ...(situation === "buying" || situation === "buying_and_selling" ? BUYING : []),
    ...(situation === "renting" ? [{ task: "Give notice and check your tenancy", detail: "Check the notice period and what the inventory says about cleaning." }] : []),
    ...(situation === "landlord" ? LANDLORD : []),
  ];
  const date = moveDate && /^\d{4}-\d{2}-\d{2}$/.test(moveDate) ? moveDate : undefined;
  const stages: ChecklistStage[] = start.length ? [{ when: situation === "landlord" ? "Before the tenants move in" : "As soon as you can", weeks_before: 12, ...(date && situation !== "landlord" ? { date: minus(date, 12) } : {}), items: start }] : [];
  if (situation === "landlord") return stages;
  for (const [weeks, when, items] of EVERY_MOVE) {
    stages.push({ when, weeks_before: weeks, ...(date && weeks !== null ? { date: minus(date, weeks) } : {}), items });
  }
  return stages;
}
