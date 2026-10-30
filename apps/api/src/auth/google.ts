import { decodeJwt } from "jose";
import type { Config } from "../config";

export interface GoogleOAuth {
  authUrl(p: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchange(p: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ email: string; emailVerified: boolean }>;
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export function createGoogleOAuth(
  cfg: Config["google"],
  fetchImpl: typeof fetch = fetch,
): GoogleOAuth {
  return {
    authUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL(AUTH_ENDPOINT);
      url.search = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      return url.toString();
    },

    async exchange({ code, codeVerifier, redirectUri }) {
      const res = await fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          grant_type: "authorization_code",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id_token?: unknown;
        error?: unknown;
      };
      if (!res.ok) {
        throw new Error(
          `Google token exchange failed: ${String(body.error ?? res.status)}`,
        );
      }
      if (typeof body.id_token !== "string") {
        throw new Error("Google token response had no id_token");
      }
      // The token arrives straight from Google over TLS in the server-side
      // code flow, so the signature check is skipped (per Google's guidance).
      const claims = decodeJwt(body.id_token);
      if (!claims.iss || !ISSUERS.includes(claims.iss)) {
        throw new Error("id_token has an unexpected issuer");
      }
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (aud.length !== 1 || aud[0] !== cfg.clientId) {
        throw new Error("id_token was issued for another client");
      }
      if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
        throw new Error("id_token has expired");
      }
      if (typeof claims.email !== "string" || !claims.email) {
        throw new Error("id_token has no email");
      }
      return {
        email: claims.email,
        emailVerified: claims.email_verified === true,
      };
    },
  };
}
