import { DEFAULT_DATABASE_URL } from "../client";
import { resetDatabase } from "../reset";

await resetDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
