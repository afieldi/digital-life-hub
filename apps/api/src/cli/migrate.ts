import { databaseUrlFrom } from "@dlh/db";
import { migrateAll } from "../migrate";
import { serverModules } from "../modules.gen";

await migrateAll(databaseUrlFrom(process.env), serverModules);
