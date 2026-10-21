/**
 * Homemove tool-call activity for the Slack feed the Homedata and Home apps post to
 * (src/activity.ts sends it). One line per call: an anonymous visitor (src/home/activity.ts),
 * the tool, what was asked at area level and what came back: the service and its price,
 * a front door, a broadband deal opened. Never an address, a street, a typed price or a deposit.
 */
import { coarsePlace } from "../home/activity.js";
import { HOMEMOVE_TOOL_LIST } from "./server.js";

let known: Set<string> | undefined;

/** A tool name safe to show: one Homemove lists, never one the caller made up. */
export function shownToolName(name: unknown): string {
  known ??= new Set<string>(HOMEMOVE_TOOL_LIST.map((tool) => tool.name));
  return typeof name === "string" && known.has(name) ? name : "unknown tool";
}

const gbp = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `£${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : undefined);
const area = (...values: unknown[]) => values.map((v) => coarsePlace(v)).find((v) => v && v !== "an address");

/** What a call was about and what it found, at area level. */
export function callDetail(tool: string, args: Record<string, unknown>, body: Record<string, unknown> | undefined): string | undefined {
  const b = body ?? {};
  const product = (b["product"] as { name?: string } | undefined)?.name;
  const parts: Array<string | undefined | false> = [];
  switch (tool) {
    case "homemove_quote": {
      const status = b["status"];
      parts.push(
        status === "front_door" ? `front door: ${String(b["name"] ?? "")}` : product,
        status === "priced" ? `priced ${gbp(b["price_gbp"])}` + ((b["assumed"] as unknown[] | undefined)?.length ? " (from records)" : "")
          : status === "needs_answers" ? (b["from_gbp"] ? `from ${gbp(b["from_gbp"])}, card asks for the home` : `asks ${((b["questions"] as Array<{ name: string }> | undefined) ?? []).map((q) => q.name).join(", ")}`)
            : status === "quoted_by_hand" ? "quoted by the team"
              : status === "choose_service" ? "asks which service"
                : status === "unknown_service" ? "no such service"
                  : status === "address_not_found" ? "address not matched, card lists the postcode" : undefined,
        (b["property"] as { uprn?: unknown } | undefined)?.uprn ? "home picked" : false,
        area(args["postcode"], b["postcode"]),
        typeof args["to_postcode"] === "string" && `to ${area(args["to_postcode"]) ?? "?"}`);
      break;
    }
    case "homemove_move_plan":
      parts.push(String(args["situation"] ?? ""), typeof b["priced"] === "number" && `${b["priced"]} of ${(b["lines"] as unknown[] | undefined)?.length ?? "?"} steps priced, ${gbp(b["total_gbp"])}`, area(args["to_postcode"], args["from_postcode"]));
      break;
    case "homemove_stamp_duty": parts.push(String(args["buyer_type"] ?? "")); break;
    case "homemove_broadband": parts.push(area(args["postcode"]), typeof b["total"] === "number" && `${b["total"]} deals`, args["sort"] === "speed" && "fastest first"); break;
    case "homemove_broadband_link": parts.push("deal opened", area(args["postcode"])); break;
    case "homemove_moving_checklist": parts.push(String(args["situation"] ?? ""), typeof args["move_date"] === "string" && "dated"); break;
    case "homemove_council_tax": parts.push(area(args["postcode"]), typeof b["council_tax_band"] === "string" && `band ${b["council_tax_band"]}`); break;
    case "homemove_find_address": parts.push(typeof (b["addresses"] as unknown[] | undefined)?.length === "number" && `${(b["addresses"] as unknown[]).length} addresses`); break;
    case "homemove_services": parts.push(typeof args["type"] === "string" && args["type"]); break;
  }
  const text = parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(", ");
  return text || undefined;
}
