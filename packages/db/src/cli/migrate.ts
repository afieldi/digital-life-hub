import { DEFAULT_DATABASE_URL } from "../client";
import { migrate } from "../migrate";

await migrate(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
