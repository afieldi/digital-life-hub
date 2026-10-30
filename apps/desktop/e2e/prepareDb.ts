import { freshTestDb } from "@dlh/db/testing";

// Runs before the API starts (see playwright.config.ts): wiping and migrating
// under a live API connection pool would break it.
const { close } = await freshTestDb();
await close();
