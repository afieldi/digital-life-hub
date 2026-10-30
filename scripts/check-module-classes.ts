import { globSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type Violation = { file: string; line: number; className: string };

const DISALLOWED = [
  "bg-",
  "text-",
  "border-",
  "ring-",
  "shadow-",
  "backdrop-",
  "font-",
  "rounded-",
  "opacity-",
  "from-",
  "to-",
  "via-",
  "fill-",
  "stroke-",
];
const ALLOWED = new Set(["text-left", "text-center", "text-right", "border-0"]);

// className="…", className={'…'}, className={"…"}, className={`…`}
const CLASS_ATTR =
  /className=(?:"([^"]*)"|\{\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)\s*\})/g;

/** Drop variant prefixes (hover:, md:, data-[x]:) – splits on ':' outside brackets. */
function baseClass(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, "");
}

function isViolation(token: string): boolean {
  const base = baseClass(token);
  if (base.includes("[") && (base.includes("#") || base.includes("rgb")))
    return true;
  if (ALLOWED.has(base)) return false;
  return DISALLOWED.some((p) => base.startsWith(p));
}

export function findViolations(source: string, file: string): Violation[] {
  const out: Violation[] = [];
  for (const m of source.matchAll(CLASS_ATTR)) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (value === undefined || value.includes("${")) continue;
    const line = source.slice(0, m.index).split("\n").length;
    for (const token of value.split(/\s+/).filter(Boolean)) {
      if (isViolation(token)) out.push({ file, line, className: token });
    }
  }
  return out;
}

function main(): void {
  const files = globSync("modules/**/*.tsx");
  if (files.length === 0) {
    console.log("check-module-classes: no module files");
    return;
  }
  const violations = files.flatMap((f) =>
    findViolations(readFileSync(f, "utf8"), f),
  );
  for (const v of violations) {
    console.error(
      `${v.file}:${v.line}  ${v.className}  (modules may only use layout classes)`,
    );
  }
  if (violations.length > 0) process.exit(1);
  console.log(`check-module-classes: ${files.length} files OK`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
