"use strict";
/* Runs every suite.  node test/run-all.js */
const { spawnSync } = require("child_process");
const path = require("path");
let failed = 0;
for (const f of ["cycles", "migration", "expenses", "persistence", "static"]) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f + ".test.js")], { encoding: "utf8" });
  const lines = (r.stdout || "").trim().split("\n");
  console.log(f.padEnd(12) + (r.status === 0 ? "PASS  " : "FAIL  ") + lines[lines.length - 1].trim());
  if (r.status !== 0) { failed++; console.log(r.stdout); console.log(r.stderr); }
}
console.log(failed ? "\n" + failed + " suite(s) FAILED" : "\nall suites passed");
process.exit(failed ? 1 : 0);
