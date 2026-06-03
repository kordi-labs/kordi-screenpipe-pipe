// Cron entrypoint. pipe.json schedules a GET to this route.
import { NextResponse } from "next/server";
import { runScan } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await runScan();
    return NextResponse.json(summary, { status: summary.ok ? 200 : 400 });
  } catch (e) {
    console.error("kordi: scan route error", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
