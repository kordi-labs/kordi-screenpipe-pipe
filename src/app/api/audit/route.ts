// Local subscription audit — the "value before signup" hook. Scans the screen
// and returns what it found. Needs NO Kordi account.
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/settings";
import { collectDetections, AUDIT_WINDOW_MS } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const cfg = await getConfig();
    const end = new Date();
    const start = new Date(end.getTime() - AUDIT_WINDOW_MS);
    const { detections, scanned, totalMonthly, ollamaUsed } = await collectDetections(
      cfg,
      start.toISOString(),
      end.toISOString(),
    );
    return NextResponse.json({
      ok: true,
      count: detections.length,
      totalMonthly,
      ollamaUsed,
      scanned,
      connected: Boolean(cfg.mcpUrl),
      subscriptions: detections.map((d) => ({
        name: d.name,
        amount: d.amount,
        billDate: d.billDate,
        via: d.via,
      })),
    });
  } catch (e) {
    console.error("kordi: audit error", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
