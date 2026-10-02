/**
 * The ChatGPT golden prompt set (docs/chatgpt-app/golden-prompts.json) and the
 * structural checks that keep it honest against a tool list: every expected
 * tool exists, every expected argument is one the tool accepts, enum values
 * are allowed, every tool is exercised, and the review packet holds exactly
 * the five positive and three negative cases OpenAI asks for.
 *
 * These checks cannot judge model behaviour; that is what running the set in
 * developer mode is for. They stop the set drifting from the tools it tests.
 */
export type CaseKind = "direct" | "indirect" | "followup" | "negative" | "boundary";

export interface GoldenCase {
  id: string;
  kind: CaseKind;
  review: boolean;
  prompt: string;
  expect: {
    /** Must be called, in order unless the outcome says any order. */
    calls: ExpectedCall[];
    /** May be called but is not required. Anything outside calls and allowed fails the case. */
    allowed?: ExpectedCall[];
    outcome: string;
  };
  why?: string;
}

export interface ExpectedCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface GoldenSet {
  version: string;
  cases: GoldenCase[];
}

export interface ListedTool {
  name: string;
  inputSchema: { properties?: Record<string, { enum?: unknown[]; items?: { enum?: unknown[] } }> };
}

const KINDS: CaseKind[] = ["direct", "indirect", "followup", "negative", "boundary"];

/** Problems with the set against these tools; empty means it holds. */
export function checkGoldenSet(set: GoldenSet, tools: ListedTool[]): string[] {
  const problems: string[] = [];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const ids = new Set<string>();
  const prompts = new Set<string>();
  const exercised = new Set<string>();

  for (const c of set.cases) {
    const at = `case ${c.id}`;
    if (ids.has(c.id)) problems.push(`${at}: duplicate id`);
    ids.add(c.id);
    if (prompts.has(c.prompt)) problems.push(`${at}: duplicate prompt`);
    prompts.add(c.prompt);
    if (!KINDS.includes(c.kind)) problems.push(`${at}: unknown kind ${c.kind}`);
    if (!c.expect?.outcome) problems.push(`${at}: no expected outcome`);
    if (c.kind === "negative" && (c.expect.calls.length > 0 || (c.expect.allowed ?? []).length > 0)) {
      problems.push(`${at}: a negative case must expect and allow no calls`);
    }
    if (c.review && c.kind === "boundary") problems.push(`${at}: boundary cases are not part of the review packet`);
    if ((c.kind === "negative" || c.kind === "boundary") && !c.why) problems.push(`${at}: say why it must not act`);
    if (c.kind === "followup") {
      const after = /^\(after ([\w-]+)\)/.exec(c.prompt)?.[1];
      if (!after || !set.cases.some((o) => o.id === after)) problems.push(`${at}: name the case it follows, as "(after <id>)"`);
    }

    for (const call of c.expect.calls) exercised.add(call.tool);
    // Allowed calls are validated like required ones, but only a required
    // call counts as exercising a tool.
    for (const call of [...c.expect.calls, ...(c.expect.allowed ?? [])]) {
      const tool = byName.get(call.tool);
      if (!tool) {
        problems.push(`${at}: expects ${call.tool}, which the endpoint does not list`);
        continue;
      }
      const properties = tool.inputSchema.properties ?? {};
      for (const [arg, value] of Object.entries(call.args)) {
        const schema = properties[arg];
        if (!schema) problems.push(`${at}: ${call.tool} has no argument ${arg}`);
        else if (schema.enum && !schema.enum.includes(value)) problems.push(`${at}: ${call.tool}.${arg}=${String(value)} is not allowed`);
        else if (schema.items?.enum && Array.isArray(value)) {
          for (const item of value) if (!schema.items.enum.includes(item)) problems.push(`${at}: ${call.tool}.${arg} item ${String(item)} is not allowed`);
        }
      }
    }
  }

  for (const t of tools) {
    if (!exercised.has(t.name)) problems.push(`tool ${t.name}: no case exercises it`);
  }

  const review = set.cases.filter((c) => c.review);
  const positive = review.filter((c) => c.kind !== "negative" && c.kind !== "boundary").length;
  const negative = review.filter((c) => c.kind === "negative").length;
  if (positive !== 5) problems.push(`review packet: ${positive} positive cases, OpenAI asks for 5`);
  if (negative !== 3) problems.push(`review packet: ${negative} negative cases, OpenAI asks for 3`);
  if (review.length !== 8) problems.push(`review packet: ${review.length} cases in all, OpenAI asks for 8 (5 positive, 3 negative)`);

  return problems;
}
