/**
 * Policy audit logger.
 *
 * In-memory ring buffer: keeps the last MAX_ENTRIES decisions.
 * Survives across requests within the same server process.
 * Safe to expose via the /api/policy-log dev endpoint because:
 *   - Never logs full message text (only a redacted summary)
 *   - Never logs computed data or evidence rows
 *   - Only records intent classification + allow/deny decision
 */

import type { PolicyLogEntry } from "./types";

const MAX_ENTRIES = 500;
let _seq = 0;

const _log: PolicyLogEntry[] = [];

export function logPolicyDecision(entry: Omit<PolicyLogEntry, "seq">): PolicyLogEntry {
  const full: PolicyLogEntry = { ...entry, seq: ++_seq };
  _log.push(full);
  if (_log.length > MAX_ENTRIES) _log.shift();

  if (process.env.NODE_ENV !== "production") {
    const prefix = full.allowed ? "✓ ALLOW" : `✗ DENY [${full.violationCode ?? "?"}]`;
    console.log(
      `[policy] ${prefix} investor=${full.investorId} intent=${full.intent ?? "-"} reason=${full.reason ?? "-"}`
    );
  }

  return full;
}

export function getPolicyLog(): PolicyLogEntry[] {
  return [..._log];
}

export function getPolicyLogStats(): {
  total: number;
  denied: number;
  deniedByCode: Record<string, number>;
  lastSeq: number;
} {
  const denied = _log.filter((e) => !e.allowed);
  const deniedByCode: Record<string, number> = {};
  for (const e of denied) {
    const code = e.violationCode ?? "UNKNOWN";
    deniedByCode[code] = (deniedByCode[code] ?? 0) + 1;
  }
  return {
    total: _log.length,
    denied: denied.length,
    deniedByCode,
    lastSeq: _seq,
  };
}

/**
 * Produce a redacted summary of a message suitable for logging.
 * In production: "[N chars, intent=X]"
 * In development: first 120 chars then "…"
 */
export function redactMessage(
  message: string,
  intent?: string
): string {
  if (process.env.NODE_ENV === "production") {
    return `[${message.length} chars${intent ? `, intent=${intent}` : ""}]`;
  }
  const trimmed = message.replace(/\s+/g, " ").trim();
  return trimmed.length > 120 ? trimmed.slice(0, 120) + "…" : trimmed;
}
