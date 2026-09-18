import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeAllAuthFiles, writeAuthFile, writeAuthFiles, writeCodexAuthFile, writePiAuthFile } from "./auth";
import { switchNext, switchToAccount } from "./commands/switch";
import { loadConfig, saveConfig } from "./config";
import { createTestPaths, getPaths, resetPaths, setPaths } from "./paths";
import { writeActiveAuthFilesIfCurrent } from "./refresh";
import {
  resetSecretStoreAdapter,
  setSecretStoreAdapter,
  type SecretStoreAdapter,
} from "./secrets/store";
import type { Config, OAuthPayload } from "./types";

const TEST_ACCOUNT_1 = "switch-test-account-1-" + Date.now();
const TEST_ACCOUNT_2 = "switch-test-account-2-" + Date.now();
const originalPiAgentDir = process.env.PI_CODING_AGENT_DIR;

const TEST_PAYLOAD_1: OAuthPayload = {
  refresh: "refresh-token-1",
  access: "access-token-1",
  expires: Date.now() + 3600000,
  accountId: TEST_ACCOUNT_1,
  idToken: "id-token-1",
};

const TEST_PAYLOAD_2: OAuthPayload = {
  refresh: "refresh-token-2",
  access: "access-token-2",
  expires: Date.now() + 3600000,
  accountId: TEST_ACCOUNT_2,
};

const createInMemorySecretStoreAdapter = (
  initialPayloads: OAuthPayload[] = [],
): SecretStoreAdapter => {
  const payloads = new Map<string, OAuthPayload>(
    initialPayloads.map((payload) => [payload.accountId, payload]),
  );

  return {
    id: "test-memory-secret-store",
    label: "Test memory secret store",
    getServiceName: (accountId: string) => `test-${accountId}`,
    save: async (accountId: string, payload: OAuthPayload) => {
      payloads.set(accountId, payload);
    },
    load: async (accountId: string) => {
      const payload = payloads.get(accountId);
      if (!payload) {
        throw new Error(`No stored credentials found for account ${accountId}.`);
      }
      return payload;
    },
    delete: async (accountId: string) => {
      payloads.delete(accountId);
    },
    exists: async (accountId: string) => payloads.has(accountId),
    listAccountIds: async () => [...payloads.keys()],
    getCapability: () => ({ available: true }),
  };
};

const silenceStdout = async (fn: () => Promise<void>): Promise<void> => {
  const originalWrite = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
};

describe("switch command utilities", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `cdx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    const testPaths = createTestPaths(testDir);
    setPaths(testPaths);

    setSecretStoreAdapter(
      createInMemorySecretStoreAdapter([TEST_PAYLOAD_1, TEST_PAYLOAD_2]),
    );
  });

  afterEach(() => {
    if (originalPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalPiAgentDir;
    }
    resetSecretStoreAdapter();
    resetPaths();

    try {
      rmSync(testDir, { recursive: true });
    } catch {
      // Cleanup - ignore if not exists
    }
  });

  describe("writeAuthFile", () => {
    it("writes auth.json in correct format to test directory", async () => {
      await writeAuthFile(TEST_PAYLOAD_1);

      const { authPath } = getPaths();
      expect(authPath.startsWith(testDir)).toBe(true);
      expect(existsSync(authPath)).toBe(true);

      const content = await readFile(authPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed.openai.type).toBe("oauth");
      expect(parsed.openai.refresh).toBe(TEST_PAYLOAD_1.refresh);
      expect(parsed.openai.access).toBe(TEST_PAYLOAD_1.access);
      expect(parsed.openai.expires).toBe(TEST_PAYLOAD_1.expires);
      expect(parsed.openai.accountId).toBe(TEST_PAYLOAD_1.accountId);
    });

    it("preserves non-openai sections in existing auth.json", async () => {
      const { authPath } = getPaths();
      const authDir = path.dirname(authPath);
      mkdirSync(authDir, { recursive: true });

      const existing = {
        anthropic: { key: "sk-ant-xxx", model: "claude-4" },
        custom: { foo: "bar" },
      };
      await writeFile(authPath, JSON.stringify(existing, null, 2), "utf8");

      await writeAuthFile(TEST_PAYLOAD_1);

      const content = await readFile(authPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed.anthropic.key).toBe("sk-ant-xxx");
      expect(parsed.anthropic.model).toBe("claude-4");
      expect(parsed.custom.foo).toBe("bar");
      expect(parsed.openai.type).toBe("oauth");
      expect(parsed.openai.accountId).toBe(TEST_PAYLOAD_1.accountId);
    });
  });

  describe("writeCodexAuthFile", () => {
    it("writes codex auth.json in correct format", async () => {
      await writeCodexAuthFile(TEST_PAYLOAD_1);

      const { codexAuthPath } = getPaths();
      expect(codexAuthPath.startsWith(testDir)).toBe(true);
      expect(existsSync(codexAuthPath)).toBe(true);

      const content = await readFile(codexAuthPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed.tokens.id_token).toBe("id-token-1");
      expect(parsed.tokens.access_token).toBe(TEST_PAYLOAD_1.access);
      expect(parsed.tokens.refresh_token).toBe(TEST_PAYLOAD_1.refresh);
      expect(parsed.tokens.account_id).toBe(TEST_PAYLOAD_1.accountId);
      expect(parsed.last_refresh).toBeDefined();
    });

    it("writes null id_token when not available", async () => {
      await writeCodexAuthFile(TEST_PAYLOAD_2);

      const { codexAuthPath } = getPaths();
      const content = await readFile(codexAuthPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed.tokens.id_token).toBeNull();
    });

    it("preserves existing fields in codex auth.json", async () => {
      const { codexAuthPath } = getPaths();
      const codexAuthDir = path.dirname(codexAuthPath);
      mkdirSync(codexAuthDir, { recursive: true });

      const existing = {
        OPENAI_API_KEY: "sk-existing-key",
        tokens: { custom_field: "keep-me" },
        some_other_setting: true,
      };
      await writeFile(codexAuthPath, JSON.stringify(existing, null, 2), "utf8");

      await writeCodexAuthFile(TEST_PAYLOAD_1);

      const content = await readFile(codexAuthPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed.OPENAI_API_KEY).toBe("sk-existing-key");
      expect(parsed.some_other_setting).toBe(true);
      expect(parsed.tokens.custom_field).toBe("keep-me");
      expect(parsed.tokens.access_token).toBe(TEST_PAYLOAD_1.access);
      expect(parsed.tokens.refresh_token).toBe(TEST_PAYLOAD_1.refresh);
      expect(parsed.tokens.account_id).toBe(TEST_PAYLOAD_1.accountId);
      expect(parsed.tokens.id_token).toBe("id-token-1");
    });
  });

  describe("writePiAuthFile", () => {
    it("writes pi auth.json in correct format", async () => {
      await writePiAuthFile(TEST_PAYLOAD_1);

      const { piAuthPath } = getPaths();
      expect(piAuthPath.startsWith(testDir)).toBe(true);
      expect(existsSync(piAuthPath)).toBe(true);

      const content = await readFile(piAuthPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed["openai-codex"].type).toBe("oauth");
      expect(parsed["openai-codex"].access).toBe(TEST_PAYLOAD_1.access);
      expect(parsed["openai-codex"].refresh).toBe(TEST_PAYLOAD_1.refresh);
      expect(parsed["openai-codex"].expires).toBe(TEST_PAYLOAD_1.expires);
      expect(parsed["openai-codex"].accountId).toBe(TEST_PAYLOAD_1.accountId);
    });

    it("preserves existing sections in pi auth.json", async () => {
      const { piAuthPath } = getPaths();
      const piAuthDir = path.dirname(piAuthPath);
      mkdirSync(piAuthDir, { recursive: true });

      const existing = {
        foo: "bar",
        "openai-other": { enabled: true },
      };
      await writeFile(piAuthPath, JSON.stringify(existing, null, 2), "utf8");

      await writePiAuthFile(TEST_PAYLOAD_1);

      const content = await readFile(piAuthPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed.foo).toBe("bar");
      expect(parsed["openai-other"].enabled).toBe(true);
      expect(parsed["openai-codex"].accountId).toBe(TEST_PAYLOAD_1.accountId);
    });

    it("throws when PI_CODING_AGENT_DIR points to a non-directory path", async () => {
      const blockedPiAgentDir = path.join(testDir, "pi-agent-dir-as-file");
      await writeFile(blockedPiAgentDir, "not-a-directory", "utf8");

      process.env.PI_CODING_AGENT_DIR = blockedPiAgentDir;
      resetPaths();

      expect(getPaths().piAuthPath).toBe(path.join(blockedPiAgentDir, "auth.json"));
      await expect(writePiAuthFile(TEST_PAYLOAD_1)).rejects.toThrow(/EEXIST|ENOTDIR/);
    });
  });

  describe("writeAllAuthFiles", () => {
    it("writes both auth files when idToken is present", async () => {
      const result = await writeAllAuthFiles(TEST_PAYLOAD_1);

      const { authPath, codexAuthPath, piAuthPath } = getPaths();
      expect(existsSync(authPath)).toBe(true);
      expect(existsSync(codexAuthPath)).toBe(true);
      expect(existsSync(piAuthPath)).toBe(true);
      expect(result.piWritten).toBe(true);
      expect(result.codexWritten).toBe(true);
      expect(result.codexMissingIdToken).toBe(false);
    });

    it("clears codex auth when idToken is missing", async () => {
      const { codexAuthPath } = getPaths();
      await mkdirSync(path.dirname(codexAuthPath), { recursive: true });
      await writeFile(codexAuthPath, JSON.stringify({ tokens: { account_id: "stale" } }, null, 2), "utf8");
      expect(existsSync(codexAuthPath)).toBe(true);

      const result = await writeAllAuthFiles(TEST_PAYLOAD_2);

      const { authPath, piAuthPath } = getPaths();
      expect(existsSync(authPath)).toBe(true);
      expect(existsSync(piAuthPath)).toBe(true);
      expect(result.piWritten).toBe(true);
      expect(existsSync(codexAuthPath)).toBe(false);
      expect(result.codexWritten).toBe(false);
      expect(result.codexMissingIdToken).toBe(true);
      expect(result.codexCleared).toBe(true);
    });
  });

  describe("writeAuthFiles", () => {
    it("writes all supported auth files when targets are not configured through writeAllAuthFiles", async () => {
      const result = await writeAllAuthFiles(TEST_PAYLOAD_1);

      const { authPath, codexAuthPath, piAuthPath } = getPaths();
      expect(existsSync(authPath)).toBe(true);
      expect(existsSync(codexAuthPath)).toBe(true);
      expect(existsSync(piAuthPath)).toBe(true);
      expect(result.targetResults).toEqual({
        opencode: "written",
        codex: "written",
        pi: "written",
      });
    });

    it("updates OpenCode only when targets contains only opencode", async () => {
      const result = await writeAuthFiles(TEST_PAYLOAD_1, ["opencode"]);

      const { authPath, codexAuthPath, piAuthPath } = getPaths();
      expect(existsSync(authPath)).toBe(true);
      expect(existsSync(codexAuthPath)).toBe(false);
      expect(existsSync(piAuthPath)).toBe(false);
      expect(result.opencodeWritten).toBe(true);
      expect(result.codexWritten).toBe(false);
      expect(result.piWritten).toBe(false);
      expect(result.targetResults.codex).toBe("skipped");
      expect(result.targetResults.pi).toBe("skipped");
    });

    it("leaves existing Codex auth unchanged when only OpenCode is targeted", async () => {
      const { codexAuthPath } = getPaths();
      await mkdirSync(path.dirname(codexAuthPath), { recursive: true });
      const existing = JSON.stringify({ tokens: { account_id: "codex-stays" } }, null, 2);
      await writeFile(codexAuthPath, existing, "utf8");

      await writeAuthFiles(TEST_PAYLOAD_1, ["opencode"]);

      await expect(readFile(codexAuthPath, "utf8")).resolves.toBe(existing);
    });

    it("leaves existing Pi auth unchanged when only OpenCode is targeted", async () => {
      const { piAuthPath } = getPaths();
      await mkdirSync(path.dirname(piAuthPath), { recursive: true });
      const existing = JSON.stringify({ "openai-codex": { accountId: "pi-stays" } }, null, 2);
      await writeFile(piAuthPath, existing, "utf8");

      await writeAuthFiles(TEST_PAYLOAD_1, ["opencode"]);

      await expect(readFile(piAuthPath, "utf8")).resolves.toBe(existing);
    });

    it("does not delete Codex auth when only OpenCode is targeted and idToken is missing", async () => {
      const { codexAuthPath } = getPaths();
      await mkdirSync(path.dirname(codexAuthPath), { recursive: true });
      const existing = JSON.stringify({ tokens: { account_id: "codex-stays" } }, null, 2);
      await writeFile(codexAuthPath, existing, "utf8");

      const result = await writeAuthFiles(TEST_PAYLOAD_2, ["opencode"]);

      expect(existsSync(codexAuthPath)).toBe(true);
      await expect(readFile(codexAuthPath, "utf8")).resolves.toBe(existing);
      expect(result.codexMissingIdToken).toBe(false);
      expect(result.codexCleared).toBe(false);
      expect(result.targetResults.codex).toBe("skipped");
    });

    it("updates multiple selected targets", async () => {
      const result = await writeAuthFiles(TEST_PAYLOAD_1, ["opencode", "pi"]);

      const { authPath, codexAuthPath, piAuthPath } = getPaths();
      expect(existsSync(authPath)).toBe(true);
      expect(existsSync(piAuthPath)).toBe(true);
      expect(existsSync(codexAuthPath)).toBe(false);
      expect(result.targetResults).toEqual({
        opencode: "written",
        codex: "skipped",
        pi: "written",
      });
    });
  });

  describe("writeActiveAuthFilesIfCurrent", () => {
    it("updates auth files when refreshed account is current", async () => {
      const config: Config = {
        current: 0,
        accounts: [
          { accountId: TEST_ACCOUNT_1, keychainService: "cdx-openai-" + TEST_ACCOUNT_1 },
          { accountId: TEST_ACCOUNT_2, keychainService: "cdx-openai-" + TEST_ACCOUNT_2 },
        ],
      };

      await saveConfig(config);

      const result = await writeActiveAuthFilesIfCurrent(TEST_ACCOUNT_1);

      const { authPath, codexAuthPath, piAuthPath } = getPaths();
      expect(result?.piWritten).toBe(true);
      expect(result?.codexWritten).toBe(true);
      expect(existsSync(authPath)).toBe(true);
      expect(existsSync(codexAuthPath)).toBe(true);
      expect(existsSync(piAuthPath)).toBe(true);
    });

    it("respects configured targets when refreshed account is current", async () => {
      const config: Config = {
        current: 0,
        targets: ["opencode"],
        accounts: [
          { accountId: TEST_ACCOUNT_1, keychainService: "cdx-openai-" + TEST_ACCOUNT_1 },
          { accountId: TEST_ACCOUNT_2, keychainService: "cdx-openai-" + TEST_ACCOUNT_2 },
        ],
      };

      const { codexAuthPath, piAuthPath } = getPaths();
      await mkdirSync(path.dirname(codexAuthPath), { recursive: true });
      await mkdirSync(path.dirname(piAuthPath), { recursive: true });
      const codexExisting = JSON.stringify({ tokens: { account_id: "codex-stays" } }, null, 2);
      const piExisting = JSON.stringify({ "openai-codex": { accountId: "pi-stays" } }, null, 2);
      await writeFile(codexAuthPath, codexExisting, "utf8");
      await writeFile(piAuthPath, piExisting, "utf8");

      await saveConfig(config);

      const result = await writeActiveAuthFilesIfCurrent(TEST_ACCOUNT_1);

      const { authPath } = getPaths();
      expect(result?.targetResults).toEqual({
        opencode: "written",
        codex: "skipped",
        pi: "skipped",
      });
      expect(existsSync(authPath)).toBe(true);
      await expect(readFile(codexAuthPath, "utf8")).resolves.toBe(codexExisting);
      await expect(readFile(piAuthPath, "utf8")).resolves.toBe(piExisting);
    });

    it("skips auth file updates when refreshed account is not current", async () => {
      const config: Config = {
        current: 0,
        accounts: [
          { accountId: TEST_ACCOUNT_1, keychainService: "cdx-openai-" + TEST_ACCOUNT_1 },
          { accountId: TEST_ACCOUNT_2, keychainService: "cdx-openai-" + TEST_ACCOUNT_2 },
        ],
      };

      await saveConfig(config);

      const result = await writeActiveAuthFilesIfCurrent(TEST_ACCOUNT_2);

      const { authPath, codexAuthPath, piAuthPath } = getPaths();
      expect(result).toBeNull();
      expect(existsSync(authPath)).toBe(false);
      expect(existsSync(codexAuthPath)).toBe(false);
      expect(existsSync(piAuthPath)).toBe(false);
    });
  });

  describe("switch commands", () => {
    it("respects configured targets when switching directly", async () => {
      await saveConfig({
        current: 1,
        targets: ["opencode"],
        accounts: [
          { accountId: TEST_ACCOUNT_1, keychainService: "cdx-openai-" + TEST_ACCOUNT_1 },
          { accountId: TEST_ACCOUNT_2, keychainService: "cdx-openai-" + TEST_ACCOUNT_2 },
        ],
      });

      const { codexAuthPath, piAuthPath } = getPaths();
      await mkdirSync(path.dirname(codexAuthPath), { recursive: true });
      await mkdirSync(path.dirname(piAuthPath), { recursive: true });
      const codexExisting = JSON.stringify({ tokens: { account_id: "codex-stays" } }, null, 2);
      const piExisting = JSON.stringify({ "openai-codex": { accountId: "pi-stays" } }, null, 2);
      await writeFile(codexAuthPath, codexExisting, "utf8");
      await writeFile(piAuthPath, piExisting, "utf8");

      await silenceStdout(() => switchToAccount(TEST_ACCOUNT_1));

      const { authPath } = getPaths();
      const auth = JSON.parse(await readFile(authPath, "utf8"));
      const config = await loadConfig();
      expect(config.current).toBe(0);
      expect(auth.openai.accountId).toBe(TEST_ACCOUNT_1);
      await expect(readFile(codexAuthPath, "utf8")).resolves.toBe(codexExisting);
      await expect(readFile(piAuthPath, "utf8")).resolves.toBe(piExisting);
    });

    it("uses switch targets override without saving it to config", async () => {
      await saveConfig({
        current: 1,
        targets: ["opencode", "codex", "pi"],
        accounts: [
          { accountId: TEST_ACCOUNT_1, keychainService: "cdx-openai-" + TEST_ACCOUNT_1 },
          { accountId: TEST_ACCOUNT_2, keychainService: "cdx-openai-" + TEST_ACCOUNT_2 },
        ],
      });

      const { piAuthPath } = getPaths();
      await mkdirSync(path.dirname(piAuthPath), { recursive: true });
      const piExisting = JSON.stringify({ "openai-codex": { accountId: "pi-stays" } }, null, 2);
      await writeFile(piAuthPath, piExisting, "utf8");

      await silenceStdout(() => switchToAccount(TEST_ACCOUNT_1, ["opencode", "codex"]));

      const { authPath, codexAuthPath } = getPaths();
      const auth = JSON.parse(await readFile(authPath, "utf8"));
      const codexAuth = JSON.parse(await readFile(codexAuthPath, "utf8"));
      const config = await loadConfig();
      expect(config.current).toBe(0);
      expect(config.targets).toEqual(["opencode", "codex", "pi"]);
      expect(auth.openai.accountId).toBe(TEST_ACCOUNT_1);
      expect(codexAuth.tokens.account_id).toBe(TEST_ACCOUNT_1);
      await expect(readFile(piAuthPath, "utf8")).resolves.toBe(piExisting);
    });

    it("respects configured targets when switching to next account", async () => {
      await saveConfig({
        current: 0,
        targets: ["opencode"],
        accounts: [
          { accountId: TEST_ACCOUNT_1, keychainService: "cdx-openai-" + TEST_ACCOUNT_1 },
          { accountId: TEST_ACCOUNT_2, keychainService: "cdx-openai-" + TEST_ACCOUNT_2 },
        ],
      });

      const { codexAuthPath, piAuthPath } = getPaths();
      await mkdirSync(path.dirname(codexAuthPath), { recursive: true });
      await mkdirSync(path.dirname(piAuthPath), { recursive: true });
      const codexExisting = JSON.stringify({ tokens: { account_id: "codex-stays" } }, null, 2);
      const piExisting = JSON.stringify({ "openai-codex": { accountId: "pi-stays" } }, null, 2);
      await writeFile(codexAuthPath, codexExisting, "utf8");
      await writeFile(piAuthPath, piExisting, "utf8");

      await silenceStdout(() => switchNext());

      const { authPath } = getPaths();
      const auth = JSON.parse(await readFile(authPath, "utf8"));
      const config = await loadConfig();
      expect(config.current).toBe(1);
      expect(auth.openai.accountId).toBe(TEST_ACCOUNT_2);
      await expect(readFile(codexAuthPath, "utf8")).resolves.toBe(codexExisting);
      await expect(readFile(piAuthPath, "utf8")).resolves.toBe(piExisting);
    });

    it("uses switch next targets override without saving it to config", async () => {
      await saveConfig({
        current: 0,
        targets: ["opencode", "codex", "pi"],
        accounts: [
          { accountId: TEST_ACCOUNT_1, keychainService: "cdx-openai-" + TEST_ACCOUNT_1 },
          { accountId: TEST_ACCOUNT_2, keychainService: "cdx-openai-" + TEST_ACCOUNT_2 },
        ],
      });

      const { codexAuthPath, piAuthPath } = getPaths();
      await mkdirSync(path.dirname(codexAuthPath), { recursive: true });
      await mkdirSync(path.dirname(piAuthPath), { recursive: true });
      const codexExisting = JSON.stringify({ tokens: { account_id: "codex-stays" } }, null, 2);
      const piExisting = JSON.stringify({ "openai-codex": { accountId: "pi-stays" } }, null, 2);
      await writeFile(codexAuthPath, codexExisting, "utf8");
      await writeFile(piAuthPath, piExisting, "utf8");

      await silenceStdout(() => switchNext(["opencode"]));

      const { authPath } = getPaths();
      const auth = JSON.parse(await readFile(authPath, "utf8"));
      const config = await loadConfig();
      expect(config.current).toBe(1);
      expect(config.targets).toEqual(["opencode", "codex", "pi"]);
      expect(auth.openai.accountId).toBe(TEST_ACCOUNT_2);
      await expect(readFile(codexAuthPath, "utf8")).resolves.toBe(codexExisting);
      await expect(readFile(piAuthPath, "utf8")).resolves.toBe(piExisting);
    });
  });

  describe("config operations", () => {
    it("saves and loads config correctly from test directory", async () => {
      const testConfig: Config = {
        current: 0,
        accounts: [
          { accountId: TEST_ACCOUNT_1, keychainService: "cdx-openai-" + TEST_ACCOUNT_1 },
          { accountId: TEST_ACCOUNT_2, keychainService: "cdx-openai-" + TEST_ACCOUNT_2 },
        ],
      };

      await saveConfig(testConfig);

      const { configPath } = getPaths();
      expect(configPath.startsWith(testDir)).toBe(true);

      const loaded = await loadConfig();
      expect(loaded.current).toBe(0);
      expect(loaded.accounts.length).toBe(2);
      expect(loaded.accounts[0].accountId).toBe(TEST_ACCOUNT_1);
    });

    it("throws when config is missing", async () => {
      await expect(loadConfig()).rejects.toThrow("Missing config");
    });
  });

});

describe("cycle logic", () => {
  it("cycles correctly with two accounts", () => {
    const accounts = [{ accountId: "a" }, { accountId: "b" }];

    const nextIndex0 = (0 + 1) % accounts.length;
    expect(nextIndex0).toBe(1);

    const nextIndex1 = (1 + 1) % accounts.length;
    expect(nextIndex1).toBe(0);
  });

  it("handles single account", () => {
    const accounts = [{ accountId: "a" }];

    const nextIndex = (0 + 1) % accounts.length;
    expect(nextIndex).toBe(0);
  });
});
