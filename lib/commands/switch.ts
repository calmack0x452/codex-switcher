import type { Command } from "commander";
import { parseAuthTargets } from "../auth-targets";
import { writeAuthFiles } from "../auth";
import { loadConfig, saveConfig } from "../config";
import { handleSwitchAccount } from "../interactive";
import { getSecretStoreAdapter } from "../secrets/store";
import type { AuthTarget } from "../types";
import { exitWithCommandError } from "./errors";
import { writeSwitchSummary } from "./output";

export const switchNext = async (
  targetsOverride?: readonly AuthTarget[],
): Promise<void> => {
  const config = await loadConfig();
  const nextIndex = (config.current + 1) % config.accounts.length;
  const nextAccount = config.accounts[nextIndex];

  if (!nextAccount?.accountId) {
    throw new Error("Account entry missing accountId.");
  }

  const payload = await getSecretStoreAdapter().load(nextAccount.accountId);
  const result = await writeAuthFiles(payload, targetsOverride ?? config.targets ?? []);

  config.current = nextIndex;
  await saveConfig(config);

  const displayName = nextAccount.label ?? payload.accountId;
  writeSwitchSummary(displayName, result);
};

export const switchToAccount = async (
  identifier: string,
  targetsOverride?: readonly AuthTarget[],
): Promise<void> => {
  const config = await loadConfig();
  const index = config.accounts.findIndex(
    (account) => account.accountId === identifier || account.label === identifier,
  );

  if (index === -1) {
    throw new Error(
      `Account "${identifier}" not found. Use 'cdx login' to add it.`,
    );
  }

  const account = config.accounts[index];
  const payload = await getSecretStoreAdapter().load(account.accountId);
  const result = await writeAuthFiles(payload, targetsOverride ?? config.targets ?? []);

  config.current = index;
  await saveConfig(config);

  const displayName = account.label ?? account.accountId;
  writeSwitchSummary(displayName, result);
};

export const registerSwitchCommand = (program: Command): void => {
  program
    .command("switch")
    .description("Switch OpenAI account (interactive picker, by name, or --next)")
    .argument("[account-id]", "Account ID to switch to directly")
    .option("-n, --next", "Cycle to the next configured account")
    .option(
      "--targets <targets>",
      "Override managed auth targets for this switch only (comma-separated: opencode,codex,pi)",
    )
    .action(async (accountId: string | undefined, options: { next?: boolean; targets?: string }) => {
      try {
        const targetsOverride = options.targets
          ? parseAuthTargets([options.targets])
          : undefined;

        if (options.next) {
          await switchNext(targetsOverride);
        } else if (accountId) {
          await switchToAccount(accountId, targetsOverride);
        } else {
          await handleSwitchAccount(targetsOverride);
        }
      } catch (error) {
        exitWithCommandError(error);
      }
    });
};
