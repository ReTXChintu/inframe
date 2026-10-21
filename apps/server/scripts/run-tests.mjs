// Runs every test/*.test.ts with Node's test runner (through tsx). Node 20
// doesn't expand globs for --test itself, and npm's shell on Windows doesn't
// either, so the files are listed here.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = fs
  .readdirSync(path.join(root, "test"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join("test", f));

if (files.length === 0) {
  console.error("No test/*.test.ts files found.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test" },
});
process.exit(result.status ?? 1);
