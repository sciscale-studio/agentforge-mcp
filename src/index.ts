#!/usr/bin/env node
/**
 * agentforge-mcp — MCP server for AgentForge.
 *
 * A thin stdio MCP server exposing one tool, `agentforge_refine_prompt`, which
 * forwards a plain-language coding request to the AgentForge HTTP API
 * (POST /api/v1/refine) and returns a tool-tuned, quality-checked prompt.
 *
 * No engine logic lives here — AgentForge's backend does the work. This is a
 * pure forwarder. Get an API key at https://agentforge.sciscale.org/account/keys
 * and pass it via the AGENTFORGE_API_KEY environment variable.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL =
  process.env.AGENTFORGE_API_URL ?? "https://agentforge.sciscale.org/api/v1/refine";
const API_KEY = process.env.AGENTFORGE_API_KEY ?? "";
// Pro-tier iterative refinement can run several audit passes — allow for it.
const REQUEST_TIMEOUT_MS = 180_000;

// Mirror the values the AgentForge backend accepts (app/prompt_builder.py).
const TARGET_TOOLS = [
  "claude-code", "codex", "cursor", "aider",
  "continue", "windsurf", "kimi", "generic",
] as const;
const STYLES = ["plan-first", "direct-edit", "explore-first"] as const;

const inputSchema = {
  request: z.string()
    .min(1, "request must not be empty")
    .max(4000, "request must not exceed 4000 characters")
    .describe(
      "The coding task or feature request, in plain language. Rough and " +
      "under-specified is fine — that is exactly what gets refined."),
  target_tool: z.enum(TARGET_TOOLS)
    .default("claude-code")
    .describe("The AI coding agent the prompt is formatted for."),
  style: z.enum(STYLES)
    .default("plan-first")
    .describe(
      "Execution style baked into the prompt: 'plan-first' plans before " +
      "coding, 'direct-edit' makes the smallest change, 'explore-first' " +
      "maps the codebase first."),
};

const outputSchema = {
  prompt: z.string()
    .describe("The refined, tool-tuned prompt — hand this to your coding agent."),
  tier: z.string().describe("Account tier that produced it: 'free' or 'pro'."),
  quality: z.object({
    score: z.number(),
    max_score: z.number(),
    passed: z.boolean(),
  }).nullable().describe("Quality Engine score, or null if scoring was unavailable."),
  usage: z.object({
    used_today: z.number(),
    limit: z.number().nullable(),
  }).describe("Today's usage for this account; 'limit' is null for unlimited Pro."),
};

interface RefineApiResponse {
  prompt: string;
  tier: string;
  quality: { score: number; max_score: number; passed: boolean } | null;
  usage: { used_today: number; limit: number | null };
}

const server = new McpServer({ name: "agentforge-mcp", version: "0.1.0" });

server.registerTool(
  "agentforge_refine_prompt",
  {
    title: "Refine a prompt with AgentForge",
    description: `Turn a rough, plain-language coding request into a structured, tool-tuned prompt for an AI coding agent.

AgentForge extracts the real requirements, fills in missing edge cases, formats the prompt for the target agent's conventions, and runs it through a Quality Engine before returning it. Reach for this when a request is vague or under-specified and you want a sharper prompt before handing it to a coding agent.

Args:
  - request (string, required): the coding task in plain language, 1-4000 chars.
  - target_tool (string): one of claude-code, codex, cursor, aider, continue, windsurf, kimi, generic. Default: claude-code.
  - style (string): plan-first, direct-edit, or explore-first. Default: plan-first.

Returns the refined prompt as text. structuredContent additionally carries:
  {
    "prompt": string,
    "tier": "free" | "pro",
    "quality": { "score": number, "max_score": number, "passed": boolean } | null,
    "usage": { "used_today": number, "limit": number | null }
  }

Errors are returned as text, e.g.:
  - "API key not configured" — set AGENTFORGE_API_KEY.
  - "invalid or revoked API key" (401) — check the key at agentforge.sciscale.org.
  - "daily free limit reached" (429) — upgrade to Pro for unlimited calls.`,
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ request, target_tool, style }) => {
    if (!API_KEY) {
      return toolError(
        "API key not configured. Set the AGENTFORGE_API_KEY environment " +
        "variable — create a key at https://agentforge.sciscale.org/account/keys");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: request, target_tool, style }),
        signal: controller.signal,
      });
    } catch (err) {
      return toolError(
        err instanceof Error && err.name === "AbortError"
          ? `AgentForge did not respond within ${REQUEST_TIMEOUT_MS / 1000}s — try again.`
          : `could not reach AgentForge: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      return toolError(await describeHttpError(resp));
    }

    const data = (await resp.json()) as RefineApiResponse;
    const structured = {
      prompt: data.prompt,
      tier: data.tier,
      quality: data.quality,
      usage: data.usage,
    };
    return {
      content: [{ type: "text" as const, text: data.prompt }],
      structuredContent: structured,
    };
  }
);

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

async function describeHttpError(resp: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await resp.json()) as { detail?: string };
    if (body.detail) detail = ` — ${body.detail}`;
  } catch {
    /* error body was not JSON; the status code alone will have to do */
  }
  switch (resp.status) {
    case 401:
      return "invalid or revoked API key. Check AGENTFORGE_API_KEY, or create " +
        "a new key at https://agentforge.sciscale.org/account/keys";
    case 429:
      return `daily free limit reached${detail}. Upgrade to Pro for unlimited ` +
        "calls at https://agentforge.sciscale.org/pricing";
    case 400:
    case 422:
      return `the request was rejected${detail}.`;
    default:
      return `AgentForge API returned HTTP ${resp.status}${detail}.`;
  }
}

async function main(): Promise<void> {
  if (!API_KEY) {
    // Don't exit — start anyway so the client can connect and the tool call
    // returns a clear, actionable message instead of a generic launch failure.
    console.error(
      "agentforge-mcp: warning — AGENTFORGE_API_KEY is not set; refine calls " +
      "will fail until it is.");
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the protocol channel — all logging must go to stderr.
  console.error("agentforge-mcp running (stdio)");
}

main().catch((err) => {
  console.error("agentforge-mcp fatal:", err);
  process.exit(1);
});
