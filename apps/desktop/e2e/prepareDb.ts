import { freshModuleDb, serverModules } from "@dlh/api/testing";

// Runs before the API starts (see playwright.config.ts): wiping and migrating
// under a live API connection pool would break it.
const { close } = await freshModuleDb([...serverModules]);
await close();
