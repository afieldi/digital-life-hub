import { freshTestDb } from "@dlh/db/testing";

/** Wipes and migrates the test database the e2e API server points at. */
export default async function globalSetup(): Promise<void> {
  const { close } = await freshTestDb();
  await close();
}
