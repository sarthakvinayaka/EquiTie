import { NextResponse } from "next/server";
import { getDatabase, listInvestors } from "@/lib/data/loader";

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDatabase();
    const investors = listInvestors(db);
    return NextResponse.json({ investors });
  } catch (err) {
    console.error("[investors] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
