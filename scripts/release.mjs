#!/usr/bin/env node
// Bump every app to one version, commit, tag vX.Y.Z and push.
//
//   npm run release:patch          0.1.0 → 0.1.1
//   npm run release:minor          0.1.0 → 0.2.0
//   npm run release:major          0.1.0 → 1.0.0
//   npm run release -- 1.4.0       exact version
//   add --dry-run to preview, --no-push to commit + tag locally only
//
// Pushing the tag starts .github/workflows/android-release.yml, which builds
// the signed APK, creates the GitHub release, and deploys to the server.
//
// Versioned files: package.json (root), apps/server/package.json,
// apps/web/package.json, package-lock.json, apps/mobile/pubspec.yaml
// (version name + build number, which always goes up by one).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const push = !args.includes("--no-push");
const bump = args.find((a) => !a.startsWith("--"));

const die = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const file = (rel) => path.join(root, rel);
const readJson = (rel) => JSON.parse(fs.readFileSync(file(rel), "utf8"));
const writeJson = (rel, data) => fs.writeFileSync(file(rel), `${JSON.stringify(data, null, 2)}\n`);

if (!bump) die("say which release: patch | minor | major | X.Y.Z (e.g. npm run release:patch)");

// ─── Work out the new version ────────────────────────────────────────────
const current = readJson("package.json").version;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!m) die(`root package.json version "${current}" isn't X.Y.Z`);
let [major, minor, patch] = m.slice(1).map(Number);
let next;
if (bump === "major") next = `${major + 1}.0.0`;
else if (bump === "minor") next = `${major}.${minor + 1}.0`;
else if (bump === "patch") next = `${major}.${minor}.${patch + 1}`;
else if (/^\d+\.\d+\.\d+$/.test(bump)) next = bump;
else die(`"${bump}" isn't patch, minor, major or an X.Y.Z version`);
const cmp = (a, b) => a.split(".").map(Number).reduce((r, n, i) => r || n - b.split(".").map(Number)[i], 0);
if (cmp(next, current) <= 0) die(`${next} must be higher than the current ${current}`);
const tag = `v${next}`;

// ─── Safety checks (warnings only for --dry-run) ──────────────────────────
const problem = (msg) => (dryRun ? console.warn(`  ! would stop: ${msg}`) : die(msg));
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") problem("release from the main branch");
if (git("status", "--porcelain")) problem("commit or stash your changes first (working tree isn't clean)");
if (git("tag", "--list", tag)) problem(`tag ${tag} already exists`);
if (push) {
  git("fetch", "--quiet", "origin", "main", "--tags");
  if (git("rev-list", "--count", "HEAD..origin/main") !== "0") problem("main is behind origin/main — pull first");
  if (git("ls-remote", "--tags", "origin", tag)) problem(`tag ${tag} already exists on origin`);
}

// ─── Bump every app ─────────────────────────────────────────────────────
const pubspecPath = "apps/mobile/pubspec.yaml";
const pubspec = fs.readFileSync(file(pubspecPath), "utf8");
const pv = /^version:\s*([\d.]+)\+(\d+)\s*$/m.exec(pubspec);
if (!pv) die(`couldn't find "version: X.Y.Z+N" in ${pubspecPath}`);
const build = Number(pv[2]) + 1;

const changes = [
  ["package.json", current, next],
  ["apps/server/package.json", readJson("apps/server/package.json").version, next],
  ["apps/web/package.json", readJson("apps/web/package.json").version, next],
  ["package-lock.json", readJson("package-lock.json").version, next],
  [pubspecPath, `${pv[1]}+${pv[2]}`, `${next}+${build}`],
];
console.log(`Release ${tag}${dryRun ? " (dry run)" : ""}`);
for (const [f, from, to] of changes) console.log(`  ${f.padEnd(28)} ${from} → ${to}`);
if (dryRun) process.exit(0);

for (const rel of ["package.json", "apps/server/package.json", "apps/web/package.json"]) {
  const data = readJson(rel);
  data.version = next;
  writeJson(rel, data);
}
const lock = readJson("package-lock.json");
lock.version = next;
for (const key of ["", "apps/server", "apps/web"]) if (lock.packages?.[key]) lock.packages[key].version = next;
writeJson("package-lock.json", lock);
fs.writeFileSync(file(pubspecPath), pubspec.replace(pv[0], `version: ${next}+${build}`));

// ─── Commit, tag, push ──────────────────────────────────────────────────
git("add", ...changes.map(([f]) => f));
git("commit", "-q", "-m", `Release ${tag}`);
git("tag", "-a", tag, "-m", `InFrame ${tag}`);
console.log(`Committed and tagged ${tag}.`);
if (push) {
  execFileSync("git", ["push", "--atomic", "origin", "main", tag], { cwd: root, stdio: "inherit" });
  console.log(`Pushed. GitHub Actions now builds the APK, publishes the ${tag} release and deploys it.`);
} else {
  console.log(`Not pushed. When ready: git push --atomic origin main ${tag}`);
}
