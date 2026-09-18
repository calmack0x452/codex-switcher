import type { Command } from "commander";
import { AUTH_TARGETS, parseAuthTargets } from "../auth-targets";
import { loadConfig, saveConfig } from "../config";
import { exitWithCommandError } from "./errors";

export const registerTargetsCommand = (program: Command): void => {
  program
    .command("targets")
    .description("Show or set managed auth targets")
    .argument("[targets...]", `Auth targets to manage (${AUTH_TARGETS.join("|")})`)
    .action(async (targets: string[]) => {
      try {
        const config = await loadConfig();

        if (targets.length === 0) {
          process.stdout.write(`Auth targets: ${config.targets?.join(", ") ?? ""}\n`);
          return;
        }

        config.targets = parseAuthTargets(targets);
        await saveConfig(config);
        process.stdout.write(`Auth targets updated: ${config.targets.join(", ")}\n`);
      } catch (error) {
        exitWithCommandError(error);
      }
    });
};
