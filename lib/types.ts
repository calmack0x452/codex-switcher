export type SecretStoreSelection = "auto" | "legacy-keychain";

export type AuthTarget = "opencode" | "codex" | "pi";

export type AccountRecord = {
  accountId: string;
  keychainService: string;
  label?: string;
};

export type Config = {
  current: number;
  accounts: AccountRecord[];
  targets?: AuthTarget[];
  secretStore?: SecretStoreSelection;
};

export type OAuthPayload = {
  refresh: string;
  access: string;
  expires: number;
  accountId: string;
  idToken?: string;
};
