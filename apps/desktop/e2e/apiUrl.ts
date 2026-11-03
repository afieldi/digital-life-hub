// Dedicated e2e API port: never collides with a dev API on the default 8787.
export const E2E_API_PORT = 18787;
export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;

/**
 * e2e's own database, reset before each run (e2e/prepareDb.ts): not the dev
 * database, nor the test suites' copies.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://dlh:dlh@127.0.0.1:54329/dlh_e2e";
