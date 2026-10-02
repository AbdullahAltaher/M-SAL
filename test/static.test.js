"use strict";
/* Static guard rails on index.html: the standing rules of the project.
   Run: node test/static.test.js */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./blocks");
const { test, done } = L.runner("static");

const html = L.html;
const backup = fs.readFileSync(path.join(__dirname, "..", "index.backup.html"), "utf8");
const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the page script parses", () => { new Function(script); });

test("no toISOString anywhere (it shifts the day in UTC+4)", () => {
  assert.ok(!/toISOString/.test(noComments(script)));
});

test("zoom is not disabled and the viewport meta is unchanged", () => {
  const meta = /<meta name="viewport"[^>]*>/.exec(html)[0];
  assert.ok(!/user-scalable|maximum-scale/.test(meta));
  assert.strictEqual(meta, /<meta name="viewport"[^>]*>/.exec(backup)[0]);
  assert.ok(/touch-action:\s*manipulation/.test(html));
});

test("no new libraries or CDN dependencies: external hosts are only the original Google Fonts ones", () => {
  const hosts = s => [...new Set((s.match(/https?:\/\/[a-z0-9.-]+/gi) || []).filter(u => !/w3\.org/.test(u)))].sort();
  assert.deepStrictEqual(hosts(html), hosts(backup));
  assert.ok(!/<script[^>]+src=/i.test(html));
});

test("the four original storage keys are still present, exactly", () => {
  for (const k of ["mizaniya.v2", "mizaniya.v2.bak", "mizaniya.v1", "mizaniya.v1.bak"]) assert.ok(html.includes('"' + k + '"'), k);
});

test("new code adds no innerHTML / insertAdjacentHTML / document.write / eval (user text goes through textContent only)", () => {
  const count = s => (noComments(s).match(/innerHTML|insertAdjacentHTML|document\.write|\beval\(/g) || []).length;
  const was = count(/<script>([\s\S]*)<\/script>/.exec(backup)[1]);
  assert.strictEqual(was, 1, "the original has exactly one (constant markup in the ledger block)");
  assert.strictEqual(count(script), was);
});

test("every user-facing input in the new UI is built with a 17px+ font (class-level CSS check)", () => {
  const css = /<style>([\s\S]*)<\/style>/.exec(html)[1];
  for (const sel of [".field", ".x-amount", ".x-select"]) {
    const m = new RegExp("\\" + sel + "\\s*\\{[^}]*font:\\s*\\d+\\s+(\\d+)px", "m").exec(css);
    assert.ok(m && +m[1] >= 17, sel + " must be at least 17px");
  }
});

test("Arabic text never gets letter-spacing in the new CSS", () => {
  const css = /<style>([\s\S]*)<\/style>/.exec(html)[1];
  const mine = css.slice(css.indexOf("/* ================= expenses ================= */"));
  assert.ok(!/letter-spacing/.test(mine));
});

test("no dead CSS: every class in the Expenses CSS is used by the markup or the script", () => {
  const css = /<style>([\s\S]*)<\/style>/.exec(html)[1];
  const mine = css.slice(css.indexOf("/* ================= expenses ================= */")).replace(/url\([^)]*\)/g, "");
  const rest = html.replace(/<style>[\s\S]*<\/style>/, "");
  const DYNAMIC = ["k-up", "k-down", "k-new"];                 /* built as "k-" + kind in the script */
  const dead = [...new Set([...mine.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]))]
    .filter(c => !rest.includes(c) && !DYNAMIC.includes(c));
  assert.deepStrictEqual(dead, [], "unused classes: " + dead.join(", "));
});

test("reduced motion is honoured and focus rings exist", () => {
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(html));
  assert.ok(/:focus-visible\s*\{/.test(html));
});

test("safe-area insets are respected by the new fixed elements", () => {
  const css = /<style>([\s\S]*)<\/style>/.exec(html)[1];
  assert.ok(/\.fab\{[^}]*safe-area-inset-bottom/.test(css));
  assert.ok(/\.sheet\{[^}]*safe-area-inset-bottom/.test(css));
  assert.ok(/\.toast-host\{[^}]*safe-area-inset-bottom/.test(css));
});

test("the backup file is the untouched original (ledger-only app: no expenses code)", () => {
  assert.ok(!/@@DATA-MODEL|viewExp|bootSafety/.test(backup));
});

test("line endings stay uniform (CRLF) as in the original", () => {
  const crlf = (html.match(/\r\n/g) || []).length, lf = (html.match(/\n/g) || []).length;
  assert.strictEqual(crlf, lf);
});

done();
