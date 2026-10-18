// tsc only emits .js — copy the SQL migrations next to the compiled migrator.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "src/db/migrations");
const to = path.join(root, "dist/db/migrations");
fs.mkdirSync(to, { recursive: true });
for (const file of fs.readdirSync(from)) fs.copyFileSync(path.join(from, file), path.join(to, file));
