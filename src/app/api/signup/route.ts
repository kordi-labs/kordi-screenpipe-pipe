// In-pipe "Sign up with Kordi": scan locally, then create the account via the
// public /api/guest-ingest endpoint and persist the returned token so future
// cron runs sync via MCP. This is the acquisition step.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfig, saveConfig } from "@/lib/settings";
import { collectDetections, AUDIT_WINDOW_MS } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "A valid email is required." }, { status: 400 });
  }

  try {
    const cfg = await getConfig();
    const end = new Date();
    const start = new Date(end.getTime() - AUDIT_WINDOW_MS);
    const { detections } = await collectDetections(cfg, start.toISOString(), end.toISOString());

    const res = await fetch(`${cfg.kordiBase.replace(/\/+$/, "")}/api/guest-ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: parsed.data.email,
        source: "screenpipe",
        subscriptions: detections.map((d) => ({ name: d.name, amount: d.amount, bill_date: d.billDate })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      imported?: number;
      total_monthly?: number;
      mcp_url?: string;
      error?: string;
    };

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data?.error || `Signup failed (${res.status}).` },
        { status: res.status },
      );
    }

    // Persist the connection so the hourly cron syncs going forward. (Absent for
    // an already-existing email — that user just gets an email link instead.)
    if (data?.mcp_url) {
      await saveConfig({ mcpUrl: data.mcp_url });
    }

    return NextResponse.json({
      ok: true,
      status: data?.status ?? "created",
      imported: data?.imported ?? detections.length,
      totalMonthly: data?.total_monthly ?? 0,
      connected: Boolean(data?.mcp_url),
    });
  } catch (e) {
    console.error("kordi: signup error", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
