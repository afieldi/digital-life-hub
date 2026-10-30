import { databaseUrlFrom } from "../client";
import { migrate } from "../migrate";

await migrate(databaseUrlFrom(process.env));
