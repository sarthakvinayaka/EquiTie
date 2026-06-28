import { NextResponse } from "next/server";
import { buildDiagnostics } from "@/lib/data/diagnostics";

// Dev-only endpoint — returns full diagnostics JSON
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  try {
    // rowRefs is a plain object after buildDiagnostics serialises it
    const summary = buildDiagnostics();
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
