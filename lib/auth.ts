import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_AUTH_TARGETS } from "./auth-targets";
import { getPaths } from "./paths";
import type { AuthTarget, OAuthPayload } from "./types";

const readExistingJson = async (filePath: string): Promise<Record<string, unknown>> => {
  if (!existsSync(filePath)) return {};
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

export const writeAuthFile = async (payload: OAuthPayload): Promise<void> => {
  const { authPath } = getPaths();
  const authDir = path.dirname(authPath);
  await mkdir(authDir, { recursive: true });

  const existing = await readExistingJson(authPath);

  existing.openai = {
    type: "oauth",
    refresh: payload.refresh,
    access: payload.access,
    expires: payload.expires,
    accountId: payload.accountId,
  };

  await writeFile(authPath, JSON.stringify(existing, null, 2), "utf8");
};

export const writeCodexAuthFile = async (payload: OAuthPayload): Promise<void> => {
  const { codexAuthPath } = getPaths();
  const codexAuthDir = path.dirname(codexAuthPath);
  await mkdir(codexAuthDir, { recursive: true });

  const existing = await readExistingJson(codexAuthPath);

  const existingTokens = typeof existing.tokens === "object" && existing.tokens !== null
    ? (existing.tokens as Record<string, unknown>)
    : {};

  existing.tokens = {
    ...existingTokens,
    id_token: payload.idToken ?? null,
    access_token: payload.access,
    refresh_token: payload.refresh,
    account_id: payload.accountId,
  };
  existing.last_refresh = new Date().toISOString();

  await writeFile(codexAuthPath, JSON.stringify(existing, null, 2), "utf8");
};

export const writePiAuthFile = async (payload: OAuthPayload): Promise<void> => {
  const { piAuthPath } = getPaths();
  const piAuthDir = path.dirname(piAuthPath);
  await mkdir(piAuthDir, { recursive: true });

  const existing = await readExistingJson(piAuthPath);

  existing["openai-codex"] = {
    type: "oauth",
    access: payload.access,
    refresh: payload.refresh,
    expires: payload.expires,
    accountId: payload.accountId,
  };

  await writeFile(piAuthPath, JSON.stringify(existing, null, 2), "utf8");
};

export type AuthTargetWriteStatus =
  | "written"
  | "skipped"
  | "missing-id-token"
  | "cleared-missing-id-token";

export type WriteAuthResult = {
  opencodeWritten: boolean;
  piWritten: boolean;
  codexWritten: boolean;
  codexMissingIdToken: boolean;
  codexCleared: boolean;
  targetResults: Record<AuthTarget, AuthTargetWriteStatus>;
};

export const writeAuthFiles = async (
  payload: OAuthPayload,
  targets: readonly AuthTarget[],
): Promise<WriteAuthResult> => {
  const selectedTargets = new Set<AuthTarget>(targets);
  const targetResults: Record<AuthTarget, AuthTargetWriteStatus> = {
    opencode: "skipped",
    codex: "skipped",
    pi: "skipped",
  };

  if (selectedTargets.has("opencode")) {
    await writeAuthFile(payload);
    targetResults.opencode = "written";
  }

  if (selectedTargets.has("pi")) {
    await writePiAuthFile(payload);
    targetResults.pi = "written";
  }

  let codexCleared = false;
  if (selectedTargets.has("codex")) {
    if (payload.idToken) {
      await writeCodexAuthFile(payload);
      targetResults.codex = "written";
    } else {
      const { codexAuthPath } = getPaths();
      if (existsSync(codexAuthPath)) {
        try {
          await rm(codexAuthPath);
          codexCleared = true;
        } catch {
          codexCleared = false;
        }
      }

      targetResults.codex = codexCleared
        ? "cleared-missing-id-token"
        : "missing-id-token";
    }
  }

  return {
    opencodeWritten: targetResults.opencode === "written",
    piWritten: targetResults.pi === "written",
    codexWritten: targetResults.codex === "written",
    codexMissingIdToken:
      targetResults.codex === "missing-id-token" ||
      targetResults.codex === "cleared-missing-id-token",
    codexCleared,
    targetResults,
  };
};

export const writeAllAuthFiles = async (payload: OAuthPayload): Promise<WriteAuthResult> =>
  writeAuthFiles(payload, DEFAULT_AUTH_TARGETS);
