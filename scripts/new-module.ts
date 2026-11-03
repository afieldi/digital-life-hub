import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export type NewModule = {
  /** The module id and folder name, e.g. `notes`. */
  id: string;
  /** Its item type, e.g. `note`. */
  type: string;
  /** Dock and page label, e.g. `Notes`. */
  label: string;
  /** The `g` + key shortcut, if any. */
  key?: string;
};

const ID = /^[a-z][a-z0-9]*$/;

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Checks a request, returning what's wrong with it or null. */
export function problemWith(m: NewModule): string | null {
  if (!ID.test(m.id))
    return `id "${m.id}" must be lowercase letters and digits`;
  if (!ID.test(m.type)) {
    return `item type "${m.type}" must be lowercase letters and digits`;
  }
  if (m.key !== undefined && !/^[a-z]$/.test(m.key)) {
    return `key "${m.key}" must be one letter a-z`;
  }
  return null;
}

/** Every file of a new module, by path under `modules/<id>`. */
export function moduleFiles(m: NewModule): Record<string, string> {
  const pkg = {
    name: `@dlh/module-${m.id}`,
    version: "0.0.0",
    private: true,
    type: "module",
    exports: { ".": "./src/manifest.tsx" },
    scripts: {
      test: "vitest run --passWithNoTests --exclude '**/*.db.test.ts'",
      "test:db": "vitest run --passWithNoTests '.db.test.ts'",
      typecheck: "tsc --noEmit -p .",
    },
    dependencies: {
      "@dlh/client": "workspace:*",
      "@dlh/core": "workspace:*",
      "@dlh/server": "workspace:*",
      "@dlh/ui": "workspace:*",
      "@tanstack/react-query": "^5.105.0",
      "@tanstack/react-router": "^1.170.46",
      "lucide-react": "^1.64.0",
      react: "^19",
      zod: "^4.6.7",
    },
    devDependencies: {
      "@types/node": "^26.6.6",
      "@types/react": "^19.3.0",
      vite: "^8.3.5",
      vitest: "^5.0.5",
    },
  };
  const Type = title(m.type);
  const nav = [
    `label: ${JSON.stringify(m.label)}`,
    'icon: "Puzzle"',
    `path: "/${m.id}"`,
    "order: 50",
    ...(m.key ? [`key: ${JSON.stringify(m.key)}`] : []),
  ].join(", ");
  return {
    "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "tsconfig.json": `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["vite/client", "vitest/globals", "node"] },
  "include": ["src", "test", "vitest.config.ts"]
}
`,
    "vitest.config.ts": `import { defineConfig } from "vitest/config";

export default defineConfig({
  // A test's first fresh database may wait for its template's migrations.
  test: { globals: true, environment: "node", testTimeout: 30_000 },
});
`,
    "src/operations.ts": `import { describeOperation, itemTitle } from "@dlh/core";
import { z } from "zod";

/** Every ${m.id} operation: its endpoint, ⌘K action and AI action. */
export const ${m.id}Ops = {
  create: describeOperation({
    id: "${m.id}.create",
    kind: "mutation",
    label: "New ${m.type}",
    description: "Creates a ${m.type} with the title given.",
    appliesTo: ["*", "none"],
    group: "create",
    input: z.object({ title: itemTitle }),
    subject: () => null,
    effects: ["createItems"],
    summary: (input) => \`New ${m.type}: \${input.title}\`,
  }),
};
`,
    "src/module.ts": `import { describeModule } from "@dlh/core";
import { ${m.id}Ops } from "./operations";

/** What ${m.label} is and does, shared by its manifest and its server module. */
export const ${m.id}Module = describeModule({
  id: "${m.id}",
  itemTypes: ["${m.type}"],
  operations: ${m.id}Ops,
});
`,
    "src/server.ts": `import {
  defineServerModule,
  implementOperation,
  type OperationsRouter,
} from "@dlh/server";
import { z } from "zod";
import { ${m.id}Module } from "./module";
import { ${m.id}Ops } from "./operations";

const create = implementOperation(${m.id}Ops.create, {
  async run(w, input) {
    if (!w.createItem) throw new Error("${m.id}.create can't create");
    const item = await w.createItem({ type: "${m.type}", title: input.title });
    return { result: item, undo: null };
  },
  // Core removes the item it created; nothing else to revert.
  async undo() {},
  undoRecord: z.null(),
});

const ${m.id}Server = defineServerModule(${m.id}Module, {
  operations: { create },
});

/** The \`${m.id}\` router as the screens call it (type only). */
export type ${title(m.id)}Router = OperationsRouter<typeof ${m.id}Server.operations>;

export default ${m.id}Server;
`,
    "src/manifest.tsx": `import { defineModule } from "@dlh/core";
import { createRoute } from "@tanstack/react-router";
import { ${title(m.id)}Page } from "./${title(m.id)}Page";
import { ${m.id}Module } from "./module";

export default defineModule(${m.id}Module, {
  itemType: {
    type: "${m.type}",
    label: "${Type}",
    glyph: "Puzzle",
    color: "var(--color-type-ai)",
    href: () => "/${m.id}",
  },
  nav: { ${nav} },
  routes: (parent) => [
    createRoute({
      getParentRoute: () => parent,
      path: "/${m.id}",
      component: ${title(m.id)}Page,
    }),
  ],
});
`,
    [`src/${title(m.id)}Page.tsx`]: `import { useCoreApi } from "@dlh/client";
import { EmptyState, ItemRow, PageHeader, SectionCard } from "@dlh/ui";
import { useQuery } from "@tanstack/react-query";
import { Puzzle } from "lucide-react";

/** Every ${m.type}. ⌘K's "New ${m.type}" creates one. */
export function ${title(m.id)}Page() {
  const core = useCoreApi();
  const list = useQuery({
    queryKey: ["${m.id}", "list"],
    queryFn: () => core.items.list.query({ types: ["${m.type}"] }),
  });
  const items = list.data?.items ?? [];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-20">
      <PageHeader title="${m.label}" />
      <SectionCard title="${m.label}">
        {items.length === 0 && list.isSuccess ? (
          <EmptyState icon={Puzzle} title="Nothing here yet" />
        ) : (
          items.map((item) => <ItemRow key={item.id} title={item.title} />)
        )}
      </SectionCard>
    </div>
  );
}
`,
    "test/create.db.test.ts": `import { freshModuleDb, testServer } from "@dlh/server/testing";
import ${m.id}Server from "../src/server";

test("${m.id}.create makes a ${m.type}, and Undo removes it", async () => {
  const t = await freshModuleDb([${m.id}Server]);
  const { caller } = testServer(t.db, [${m.id}Server]);
  const { result, undo } = await caller.${m.id}.create({ title: " First " });
  expect(result).toMatchObject({ type: "${m.type}", title: "First" });
  await caller.ops.undo({ id: "${m.id}.create", token: undo });
  expect((await caller.items.list({ types: ["${m.type}"] })).items).toEqual([]);
  await t.close();
});
`,
  };
}

/** Writes the module under `root/modules/<id>`; refuses an existing folder. */
export function writeModule(m: NewModule, root = ROOT): string[] {
  const dir = join(root, "modules", m.id);
  if (existsSync(dir)) throw new Error(`modules/${m.id} already exists`);
  const written: string[] = [];
  for (const [path, content] of Object.entries(moduleFiles(m))) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    written.push(`modules/${m.id}/${path}`);
  }
  return written;
}

function main(): void {
  const [id, type, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const at = rest.indexOf(`--${name}`);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  if (!id || !type) {
    console.error(
      "Usage: pnpm new:module <id> <item type> [--label <Label>] [--key <letter>]",
    );
    process.exit(1);
  }
  const m: NewModule = {
    id,
    type,
    label: flag("label") ?? title(id),
    key: flag("key"),
  };
  const problem = problemWith(m);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  for (const f of writeModule(m)) console.log(`  ${f}`);
  // Import order and line breaks as the repo's formatter has them.
  spawnSync("pnpm", ["biome", "check", "--write", `modules/${m.id}`], {
    cwd: ROOT,
    stdio: "ignore",
  });
  console.log(
    "\nNext: pnpm install && pnpm gen:modules, then see docs/modules.md.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
