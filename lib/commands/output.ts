import type { WriteAuthResult } from "../auth";
import { AUTH_TARGET_LABELS, AUTH_TARGETS } from "../auth-targets";
import type { AuthTarget } from "../types";

type CodexStatus = Pick<WriteAuthResult, "codexWritten" | "codexCleared">;

export const formatCodexMark = (result: CodexStatus): string => {
  if (result.codexWritten) return "✓";
  if (result.codexCleared) return "⚠ missing id_token (cleared)";
  return "⚠ missing id_token";
};

export const formatAuthTargetMark = (
  result: Pick<WriteAuthResult, "targetResults">,
  target: AuthTarget,
): string => {
  switch (result.targetResults[target]) {
    case "written":
      return "✓";
    case "cleared-missing-id-token":
      return "⚠ missing id_token (cleared)";
    case "missing-id-token":
      return "⚠ missing id_token";
    case "skipped":
      return "skipped";
  }
};

export const getAuthTargetSummaryLines = (
  result: Pick<WriteAuthResult, "targetResults">,
): string[] =>
  AUTH_TARGETS.map((target) =>
    `  ${AUTH_TARGET_LABELS[target]}: ${formatAuthTargetMark(result, target)}`,
  );

export const writeSwitchSummary = (
  displayName: string,
  result: Pick<WriteAuthResult, "targetResults">,
): void => {
  process.stdout.write(`Switched to account ${displayName}\n`);
  for (const line of getAuthTargetSummaryLines(result)) {
    process.stdout.write(`${line}\n`);
  }
};

export const writeUpdatedAuthSummary = (
  result: Pick<WriteAuthResult, "targetResults">,
): void => {
  process.stdout.write("Updated active auth files:\n");
  for (const line of getAuthTargetSummaryLines(result)) {
    process.stdout.write(`${line}\n`);
  }
};
