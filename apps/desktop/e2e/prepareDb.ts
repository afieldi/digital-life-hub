import { resetModuleDb, serverModules } from "@dlh/api/testing";
import { E2E_DATABASE_URL } from "./apiUrl";

// Runs before the API starts (see playwright.config.ts): wiping and migrating
// under a live API connection pool would break it.
await resetModuleDb(E2E_DATABASE_URL, [...serverModules]);
