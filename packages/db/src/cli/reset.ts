import { databaseUrlFrom } from "../client";
import { resetDatabase } from "../reset";

await resetDatabase(databaseUrlFrom(process.env));
