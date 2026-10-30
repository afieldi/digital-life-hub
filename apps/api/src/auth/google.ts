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
