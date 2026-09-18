import type { AuthTarget } from "./types";

export const AUTH_TARGETS = ["opencode", "codex", "pi"] as const satisfies readonly AuthTarget[];

export const DEFAULT_AUTH_TARGETS: AuthTarget[] = [...AUTH_TARGETS];

export const AUTH_TARGET_LABELS: Record<AuthTarget, string> = {
  opencode: "OpenCode",
  codex: "Codex CLI",
  pi: "Pi Agent",
};

export const isAuthTarget = (value: unknown): value is AuthTarget =>
  value === "opencode" || value === "codex" || value === "pi";

export const normalizeAuthTargets = (value: unknown): AuthTarget[] => {
  if (value === undefined) {
    return [...DEFAULT_AUTH_TARGETS];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const targets: AuthTarget[] = [];
  for (const entry of value) {
    if (isAuthTarget(entry) && !targets.includes(entry)) {
      targets.push(entry);
    }
  }

  return targets;
};

export const parseAuthTargets = (values: string[]): AuthTarget[] => {
  const rawTargets = values.flatMap((value) =>
    value.split(",").map((target) => target.trim()).filter(Boolean),
  );

  const targets: AuthTarget[] = [];
  const invalid: string[] = [];

  for (const target of rawTargets) {
    if (!isAuthTarget(target)) {
      invalid.push(target);
      continue;
    }

    if (!targets.includes(target)) {
      targets.push(target);
    }
  }

  if (invalid.length > 0) {
    throw new Error(
      `Invalid auth target${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}. Allowed values: ${AUTH_TARGETS.join(", ")}.`,
    );
  }

  if (targets.length === 0) {
    throw new Error(`At least one auth target is required. Allowed values: ${AUTH_TARGETS.join(", ")}.`);
  }

  return targets;
};
