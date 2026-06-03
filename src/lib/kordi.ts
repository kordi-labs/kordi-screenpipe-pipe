// MCP client for Kordi. Connects to the user's /mcp endpoint (the token is
// embedded in the URL copied from the dashboard) and calls the existing
// `kordi_ingest_subscription` tool with source: "screenpipe".

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import type { DetectedSub } from "./types";

export interface IngestResult {
  ok: boolean;
  status?: "created" | "updated";
  pauseLink?: string;
  dashboardUrl?: string;
  error?: string;
}

interface IngestStructured {
  status?: "created" | "updated";
  pause_link?: string;
  dashboard_url?: string;
}

export class KordiClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private connected = false;

  constructor(mcpUrl: string) {
    this.client = new Client({ name: "kordi-screenpipe-pipe", version: "0.1.0" });
    this.transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async ingest(sub: DetectedSub): Promise<IngestResult> {
    try {
      const res = await this.client.callTool({
        name: "kordi_ingest_subscription",
        arguments: {
          name: sub.name,
          amount: sub.amount,
          bill_date: sub.billDate,
          source: "screenpipe",
        },
      });

      if (res.isError) {
        return { ok: false, error: firstText(res.content) };
      }
      const sc = (res.structuredContent ?? {}) as IngestStructured;
      return { ok: true, status: sc.status, pauseLink: sc.pause_link, dashboardUrl: sc.dashboard_url };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
    this.connected = false;
  }
}

/** Pull the first text block out of a tool result's content array. */
function firstText(content: unknown): string {
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "kordi ingest failed";
}
