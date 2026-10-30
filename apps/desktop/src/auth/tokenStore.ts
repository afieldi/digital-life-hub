import { invoke } from "@tauri-apps/api/core";

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** The session token in the OS keychain (Tauri). */
export const tauriTokenStore: TokenStore = {
  get: () => invoke<string | null>("token_get"),
  set: (token) => invoke("token_set", { token }),
  clear: () => invoke("token_clear"),
};

export const DEV_TOKEN_KEY = "dlh.devSessionToken";

/** Browser dev mode only: the token in localStorage. */
export function webTokenStore(storage?: Storage): TokenStore {
  const s = () => storage ?? localStorage;
  return {
    get: async () => {
      try {
        return s().getItem(DEV_TOKEN_KEY);
      } catch {
        return null;
      }
    },
    set: async (token) => {
      try {
        s().setItem(DEV_TOKEN_KEY, token);
      } catch {
        // Storage unavailable (private mode, quota): signed in for this session only.
      }
    },
    clear: async () => {
      try {
        s().removeItem(DEV_TOKEN_KEY);
      } catch {
        // Storage unavailable: nothing was stored.
      }
    },
  };
}

/** In-memory store for tests. */
export function memoryTokenStore(initial?: string): TokenStore {
  let token: string | null = initial ?? null;
  return {
    get: async () => token,
    set: async (t) => {
      token = t;
    },
    clear: async () => {
      token = null;
    },
  };
}
