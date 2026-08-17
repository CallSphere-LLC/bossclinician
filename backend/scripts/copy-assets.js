// Copies non-TS assets that tsc does not emit into dist/, after a build.
// Kept as a file rather than an inline `node -e` so it can grow (migrations,
// email templates) without turning package.json into an unreadable one-liner.
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "src");
const dist = path.join(__dirname, "..", "dist");

function copyFile(rel) {
  const from = path.join(src, rel);
  const to = path.join(dist, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(rel, filter = () => true) {
  const from = path.join(src, rel);
  if (!fs.existsSync(from)) return;
  const to = path.join(dist, rel);
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from)) {
    if (!filter(entry)) continue;
    fs.copyFileSync(path.join(from, entry), path.join(to, entry));
  }
}

copyFile(path.join("db", "schema.sql"));
copyDir(path.join("db", "migrations"), (f) => f.endsWith(".sql"));
copyFile(path.join("seed", "data", "content.json"));

console.log("[build] copied sql + seed assets into dist/");
