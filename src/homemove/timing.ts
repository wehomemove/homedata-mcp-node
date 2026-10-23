/**
 * Where a slow quote spent its time: each upstream call made while answering one tool call is
 * recorded under a fixed stage name, and a call slower than the threshold logs the stages. Stage
 * names only: never an address, a UPRN or an answer.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const current = new AsyncLocalStorage<Array<{ stage: string; ms: number }>>();

/** Runs fn and records how long the upstream step took, when a timed tool call is in progress. */
export async function timed<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const stages = current.getStore();
  if (!stages) return fn();
  const started = Date.now();
  try { return await fn(); } finally { stages.push({ stage, ms: Date.now() - started }); }
}

/** Runs a tool call; when it takes longer than slowMs, logs each stage it waited on. */
export async function timeCall<T>(tool: string, fn: () => Promise<T>, slowMs = 3000, log: (line: string) => void = (l) => console.error(l)): Promise<T> {
  const stages: Array<{ stage: string; ms: number }> = [];
  const started = Date.now();
  try { return await current.run(stages, fn); } finally {
    const total = Date.now() - started;
    if (total > slowMs) log(`[homemove-mcp] slow ${tool}: ${total} ms (${stages.map((s) => `${s.stage} ${s.ms} ms`).join(", ") || "no upstream calls"})`);
  }
}
