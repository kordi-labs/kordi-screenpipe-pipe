// Read/write the pipe's config from the local config UI.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfig, saveConfig } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await getConfig();
  // This UI is local to the user's own machine, so returning their own
  // Connect URL (which embeds their token) is fine — it's their credential.
  return NextResponse.json({ ...cfg, mcpConfigured: Boolean(cfg.mcpUrl) });
}

const schema = z.object({
  mcpUrl: z.string().trim().optional(),
  scanIntervalMinutes: z.number().min(5).max(1440).optional(),
  enableAudio: z.boolean().optional(),
  excludeApps: z.union([z.array(z.string()), z.string()]).optional(),
  ollamaUrl: z.string().trim().optional(),
  ollamaModel: z.string().trim().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  maxIngestsPerRun: z.number().min(1).max(50).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid settings", issues: parsed.error.issues }, { status: 400 });
  }
  await saveConfig(parsed.data);
  return NextResponse.json({ ok: true });
}
