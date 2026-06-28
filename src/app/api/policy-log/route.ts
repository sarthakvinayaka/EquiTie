import { NextResponse } from "next/server";
import { getPolicyLog, getPolicyLogStats } from "@/lib/policy/logger";

/**
 * Dev-only security audit log.
 * Returns the last N policy decisions with allow/deny outcomes.
 * Blocked in production. Never contains full message text or computed data.
 *
 * GET /api/policy-log          → last 100 entries + stats
 * GET /api/policy-log?n=50     → last 50 entries
 * GET /api/policy-log?denied   → denied entries only
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const n = Math.min(parseInt(searchParams.get("n") ?? "100", 10), 500);
  const deniedOnly = searchParams.has("denied");

  let entries = getPolicyLog();
  if (deniedOnly) entries = entries.filter((e) => !e.allowed);
  entries = entries.slice(-n).reverse(); // most recent first

  const stats = getPolicyLogStats();

  return NextResponse.json({ stats, entries }, { status: 200 });
}
