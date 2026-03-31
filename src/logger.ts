/**
 * File-based logger for Windows Computer Use MCP.
 *
 * All MCP tool calls, actions, and decisions are logged to a timestamped
 * log file for debugging and audit purposes. Logs are written to
 * the `logs/` directory with daily rotation.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "./upstream/types.js";

const LOG_DIR = join(
  process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? ".", ".local"),
  "windows-computer-use-mcp",
  "logs",
);

function getLogFilePath(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return join(LOG_DIR, `mcp-${date}.log`);
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function writeLine(level: string, message: string, ...args: unknown[]): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    const extra =
      args.length > 0
        ? " " +
          args
            .map((a) => {
              try {
                return typeof a === "string" ? a : JSON.stringify(a);
              } catch {
                return String(a);
              }
            })
            .join(" ")
        : "";

    const line = `${formatTimestamp()} [${level}] ${message}${extra}\n`;
    appendFileSync(getLogFilePath(), line);
  } catch {
    // Swallow — logging failure must never block the MCP server.
  }
}

/**
 * Create a Logger that writes to both stderr and a daily log file.
 */
export function createFileLogger(serverName: string): Logger {
  return {
    info(message: string, ...args: unknown[]) {
      console.error(`[${serverName}] INFO`, message, ...args);
      writeLine("INFO", message, ...args);
    },
    error(message: string, ...args: unknown[]) {
      console.error(`[${serverName}] ERROR`, message, ...args);
      writeLine("ERROR", message, ...args);
    },
    warn(message: string, ...args: unknown[]) {
      console.error(`[${serverName}] WARN`, message, ...args);
      writeLine("WARN", message, ...args);
    },
    debug(message: string, ...args: unknown[]) {
      console.error(`[${serverName}] DEBUG`, message, ...args);
      writeLine("DEBUG", message, ...args);
    },
    silly(message: string, ...args: unknown[]) {
      writeLine("SILLY", message, ...args);
    },
  };
}

/**
 * Get the log directory path (for user reference).
 */
export function getLogDir(): string {
  return LOG_DIR;
}
