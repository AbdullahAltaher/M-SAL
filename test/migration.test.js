"use strict";
/* Migration / loader tests for index.html.   Run:  node test/migration.test.js
   All data here is synthetic and generated in memory from the shapes the app really stores
   (profiles -> data -> blocks -> rows, "~" approximate amounts, done flags, v1 keys, exports).
   Nothing is read from or written to disk apart from index.html itself.
   The code under test is extracted verbatim from the @@DATA-MODEL block of index.html. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = /\/\* @@DATA-MODEL-BEGIN[\s\S]*?\/\* @@DATA-MODEL-END \*\//.exec(html);
if (!m) { console.error("data model block not found in index.html"); process.exit(2); }
const M = new Function('"use strict";\n' + m[0] + `
  return { KEY, BAK, OLD_KEYS, SCHEMA_VERSION, sanitizeData, sanitizeState, sanitizeExp, seedData,
           loadFrom, defaultExp, defaultCategories, DEFAULT_CATEGORIES };`)();

let pass = 0, fail = 0;
function test(name, fn){
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + String(e.message).split("\n").join("\n       ")); }
}
const clone = v => JSON.parse(JSON.stringify(v));
function deepFreeze(o){ if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }

/* ---------- synthetic data generator (seeded, deterministic) ---------- */
function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = rng(20261002);
const pick = a => a[Math.floor(R() * a.length)];
const int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
const NAMES = ["عبدالله", "أم خالد", "الشركة", "مصاريف البيت", "حساب مشترك", "سارة"];
const BLOCKS = ["التزامات ثابتة", "الأقساط", "فواتير", "الأسرة", "ادخار", "سيارة", "مدارس", "هدايا ومناسبات", "ديون", "متفرقات", ""];
const ROWS = ["إيجار الشقة", "قسط السيارة", "كهرباء ومياه", "إنترنت", "مصروف البيت", "جمعية", "تأمين", "مدرسة الأولاد", "اشتراك النادي", "بنزين", "", "تحويل للأهل"];
const AMOUNTS = ["", "0", "1200", "~450", "99.5", "~1500.75", "12345.678", "3000", "~", "75", "~20", "250.25"];
let idn = 0;
const id = p => p + (++idn).toString(36) + "x" + int(100, 999);

function makeRow(){
  const r = { id: id("r"), name: pick(ROWS), amount: pick(AMOUNTS), done: R() < 0.4 };
  if (R() < 0.2) r.tag = { color: pick(["red", "gold"]), pinned: R() < 0.5 };      // unknown field on a row
  return r;
}
function makeBlock(){
  const b = { id: id("b"), title: pick(BLOCKS), rows: Array.from({ length: int(0, 12) }, makeRow) };
  if (R() < 0.3) b.collapsed = R() < 0.5;                                            // unknown field on a block
  return b;
}
function makeProfile(name){
  const p = {
    id: id("p"), name,
    data: {
      monthLabel: pick(["أكتوبر 2026", "سبتمبر 2026", "راتب ديسمبر", ""]),
      salaryLabel: pick(["الراتب", "راتب الشركة", "دخل شهري"]),
      salary: pick(["15000", "~12000", "9800.5", "", "7500"]),
      blocks: Array.from({ length: int(3, 14) }, makeBlock)
    }
  };
  if (R() < 0.6) p.data.notes = ["ملاحظة", { n: 1, deep: [1, 2, { x: null }] }];      // unknown field on data
  if (R() < 0.5) p.color = pick(["#38594A", "#B99A5B"]);                              // unknown field on the profile
  return p;
}
function makeV2State(){
  const profiles = NAMES.map(makeProfile);
  return { currentId: profiles[2].id, profiles, futureRoot: { feature: "x", list: [1, 2, 3] } };
}
const countOf = st => ({
  profiles: st.profiles.length,
  blocks: st.profiles.reduce((n, p) => n + p.data.blocks.length, 0),
  rows: st.profiles.reduce((n, p) => n + p.data.blocks.reduce((k, b) => k + b.rows.length, 0), 0),
  approx: st.profiles.reduce((n, p) => n + p.data.blocks.reduce((k, b) => k + b.rows.filter(r => r.amount.startsWith("~")).length, 0), 0),
  done: st.profiles.reduce((n, p) => n + p.data.blocks.reduce((k, b) => k + b.rows.filter(r => r.done).length, 0), 0)
});
/* what the migration is ALLOWED to add: the schema version and each profile's `exp` */
function strip(st){
  const c = clone(st);
  delete c.schemaVersion;
  for (const p of c.profiles) delete p.data.exp;
  return c;
}

/* ---------- localStorage stand-in that records writes ---------- */
function makeStore(init){
  const map = new Map(Object.entries(init || {}));
  const s = {
    writes: 0,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { s.writes++; map.set(k, String(v)); },
    removeItem: k => { s.writes++; map.delete(k); },
    snapshot: () => JSON.stringify([...map.entries()])
  };
  return s;
}

const ORIGINAL = makeV2State();                      // never mutated; all tests clone or freeze it
const C = countOf(ORIGINAL);
console.log("synthetic data: " + C.profiles + " profiles, " + C.blocks + " blocks, " + C.rows + " rows, " +
            C.approx + " approximate '~' amounts, " + C.done + " done flags\n");

/* ================= migration of existing (schema 2) data ================= */
test("fixture is rich enough to be meaningful", () => {
  assert.ok(C.profiles >= 5 && C.blocks >= 30 && C.rows >= 100 && C.approx >= 5 && C.done >= 10);
});

test("migration leaves every profile, block, row, amount and unknown field identical", () => {
  const out = M.sanitizeState(clone(ORIGINAL));
  assert.deepStrictEqual(strip(out), ORIGINAL);
  assert.deepStrictEqual(countOf(out), C);
});

test("each profile gains exactly the default exp object; root gets schemaVersion", () => {
  const out = M.sanitizeState(clone(ORIGINAL));
  assert.strictEqual(out.schemaVersion, M.SCHEMA_VERSION);
  assert.strictEqual(out.currentId, ORIGINAL.currentId);
  for (const p of out.profiles) assert.deepStrictEqual(p.data.exp, M.defaultExp());
});

test("migrating twice gives the same result (idempotent)", () => {
  const once = M.sanitizeState(clone(ORIGINAL));
  const twice = M.sanitizeState(clone(once));
  assert.deepStrictEqual(twice, once);
  assert.deepStrictEqual(M.sanitizeState(clone(twice)), once);
});

test("migration survives a JSON save/load round trip unchanged", () => {
  const once = M.sanitizeState(clone(ORIGINAL));
  const store = makeStore({ [M.KEY]: JSON.stringify(once) });
  const r = M.loadFrom(store);
  assert.deepStrictEqual(r.state, once);
  assert.strictEqual(r.migratedFrom, null, "already current: nothing to migrate");
});

test("loading schema-2 data from the real key reports the migration and writes nothing", () => {
  const store = makeStore({ [M.KEY]: JSON.stringify(ORIGINAL) });
  const before = store.snapshot();
  const r = M.loadFrom(store);
  assert.strictEqual(r.source, "main");
  assert.strictEqual(r.migratedFrom, 0);
  assert.deepStrictEqual(strip(r.state), ORIGINAL);
  assert.strictEqual(store.writes, 0);
  assert.strictEqual(store.snapshot(), before);
});

test("input is never mutated and output shares no references with it", () => {
  const frozen = deepFreeze(clone(ORIGINAL));
  const out = M.sanitizeState(frozen);                       // would throw on any write to a frozen object
  out.profiles[0].data.blocks[0].title = "CHANGED";
  out.profiles[0].data.notes = "CHANGED";
  out.profiles[0].data.exp.accounts[0].name = "CHANGED";
  assert.deepStrictEqual(frozen, ORIGINAL);
});

test("the storage keys are exactly the existing ones", () => {
  assert.strictEqual(M.KEY, "mizaniya.v2");
  assert.strictEqual(M.BAK, "mizaniya.v2.bak");
  assert.deepStrictEqual(M.OLD_KEYS, ["mizaniya.v1", "mizaniya.v1.bak"]);
});

test("known-field validation behaves as before (bad types repaired, numbers become strings)", () => {
  const out = M.sanitizeData({ monthLabel: 5, salaryLabel: null, salary: 15000,
    blocks: [null, 7, { id: 3, title: 9, rows: [null, { id: 1, name: 2, amount: 45.5, done: 1 }, "x"] }] });
  assert.strictEqual(out.salaryLabel, "الراتب");
  assert.strictEqual(out.salary, "15000");
  assert.strictEqual(out.blocks.length, 1);
  assert.strictEqual(out.blocks[0].title, "");
  assert.strictEqual(typeof out.blocks[0].id, "string");
  assert.deepStrictEqual(out.blocks[0].rows.map(r => [r.name, r.amount, r.done]), [["", "45.5", true]]);
});

test("junk profile entries are skipped, bad currentId falls back to the first profile", () => {
  const out = M.sanitizeState({ currentId: "nope", profiles: [null, 3, "x", clone(ORIGINAL.profiles[1]), clone(ORIGINAL.profiles[0])] });
  assert.strictEqual(out.profiles.length, 2);
  assert.strictEqual(out.currentId, ORIGINAL.profiles[1].id);
  assert.deepStrictEqual(strip(out).profiles, [ORIGINAL.profiles[1], ORIGINAL.profiles[0]]);
});

/* ================= exp object: existing content is preserved ================= */
function richExp(){
  return {
    accounts: [
      { id: "acc_main", name: "مصاريفي", archived: false, cycles: [
          { id: "c1", startDate: "2026-09-02", allowance: 3000, expectedNextSalaryDate: "2026-10-02", futureCycleField: [1, 2] },
          { id: "c2", startDate: "2026-10-02", allowance: 3200 } ], accFuture: { a: 1 } },
      { id: "acc_2", name: "حساب السفر", archived: true, cycles: [] }
    ],
    lastAccountId: "acc_2",
    categories: [
      { id: "cat_food", name: "أكل ومطاعم", emoji: "🍔", hidden: true, extra: "keep" },
      { id: "cat_custom1", name: "قطتي", emoji: "🐈", hidden: false }
    ],
    entries: [
      { id: "e1", type: "expense", amount: 46.25, name: "غداء", categoryId: "cat_food", date: "2026-10-03", accountId: "acc_main", entryFuture: { x: [1] } },
      { id: "e2", type: "income", amount: 100, name: "مكافأة", categoryId: "cat_other", date: "2026-10-04", accountId: "acc_main", deletedAt: 1790000000000 }
    ],
    expFuture: { z: true }
  };
}

test("an existing exp object (accounts, cycles, categories, entries, unknown fields) is preserved exactly", () => {
  const st = clone(ORIGINAL);
  st.schemaVersion = M.SCHEMA_VERSION;
  st.profiles.forEach((p, i) => {                           // every profile has its own, different exp
    p.data.exp = richExp();
    p.data.exp.accounts[0].name = "حساب " + i;
  });
  const out = M.sanitizeState(clone(st));
  assert.deepStrictEqual(out, st);
});

test("same exp object arriving without a schemaVersion (older stamp) is also preserved", () => {
  const st = clone(ORIGINAL);
  st.profiles[0].data.exp = richExp();
  const out = M.sanitizeState(clone(st));
  assert.deepStrictEqual(out.profiles[0].data.exp, richExp());
});

test("partial or damaged exp is completed, never emptied", () => {
  const e = M.sanitizeExp({ accounts: "oops", categories: [], entries: [null, 5, { name: "no id" }] });
  assert.strictEqual(e.accounts.length, 1);
  assert.strictEqual(e.accounts[0].name, "مصاريفي");
  assert.strictEqual(e.categories.length, 20);
  assert.strictEqual(e.entries.length, 1);
  assert.strictEqual(e.entries[0].name, "no id");
  assert.ok(e.entries[0].id);
  assert.strictEqual(e.lastAccountId, "acc_main");
  const e2 = M.sanitizeExp({ accounts: [{ name: "x" }, { id: "k", archived: 1, cycles: [{ startDate: "2026-01-01" }, 4] }], lastAccountId: "gone" });
  assert.strictEqual(e2.accounts[0].name, "x");
  assert.ok(e2.accounts[0].id);
  assert.strictEqual(e2.accounts[1].archived, true);
  assert.strictEqual(e2.accounts[1].cycles.length, 1);
  assert.ok(e2.accounts[1].cycles[0].id);
  assert.strictEqual(e2.accounts[1].cycles[0].startDate, "2026-01-01");
  assert.strictEqual(e2.lastAccountId, e2.accounts[0].id);
  assert.deepStrictEqual(M.sanitizeExp(clone(e2)), e2, "completed exp is a fixed point");
});

test("the 20 default categories: spec names and emoji, unique ids, none hidden", () => {
  const cats = M.defaultExp().categories;
  assert.strictEqual(cats.length, 20);
  assert.strictEqual(new Set(cats.map(c => c.id)).size, 20);
  assert.ok(cats.every(c => !c.hidden && c.name && c.emoji));
  const byName = Object.fromEntries(cats.map(c => [c.name, c.emoji]));
  assert.strictEqual(byName["أكل ومطاعم"], "🍔");
  assert.strictEqual(byName["بنزين ومواصلات"], "⛽");
  assert.strictEqual(byName["سفر"], "✈️");
  assert.strictEqual(byName["أخرى"], "📦");
  assert.strictEqual(M.defaultExp().accounts[0].name, "مصاريفي");
});

test("data from a NEWER app version is not reshaped and keeps its version", () => {
  const st = clone(ORIGINAL);
  st.schemaVersion = 99;
  st.profiles[1].data.exp = { totallyNewShape: { v: 99 } };
  const out = M.sanitizeState(clone(st));
  assert.deepStrictEqual(out, st);
});

/* ================= old-format exports and the v1 keys ================= */
function makeV1(){
  const d = clone(makeProfile("x").data);
  d.legacyField = "keep me";
  return d;
}

test("old single-person export (blocks at the root) imports intact via sanitizeData", () => {
  const old = makeV1();
  const out = M.sanitizeData(clone(old));
  const { exp, ...rest } = out;
  assert.deepStrictEqual(rest, old);
  assert.deepStrictEqual(exp, M.defaultExp());
  assert.deepStrictEqual(M.sanitizeData(clone(out)), out, "idempotent");
});

test("old multi-profile export (no schemaVersion) imports intact via sanitizeState", () => {
  const exported = JSON.stringify(ORIGINAL, null, 2);        // exactly what the export button wrote
  const out = M.sanitizeState(JSON.parse(exported));
  assert.deepStrictEqual(strip(out), ORIGINAL);
});

test("export of the new state contains ALL profiles and re-imports to the identical state", () => {
  const st = M.sanitizeState(clone(ORIGINAL));
  const file = JSON.parse(JSON.stringify(st, null, 2));
  assert.strictEqual(file.profiles.length, C.profiles);
  assert.deepStrictEqual(M.sanitizeState(file), st);
  assert.match(html, /new Blob\(\[JSON\.stringify\(state, null, 2\)\]/, "export button must stringify the whole state");
});

test("v1 key (single person) migrates into one profile named الأساسي with all data intact", () => {
  const v1 = makeV1();
  const store = makeStore({ [M.OLD_KEYS[0]]: JSON.stringify(v1) });
  const r = M.loadFrom(store);
  assert.strictEqual(r.source, "v1");
  assert.strictEqual(r.migratedFrom, "v1");
  assert.strictEqual(r.state.profiles.length, 1);
  assert.strictEqual(r.state.profiles[0].name, "الأساسي");
  const { exp, ...rest } = r.state.profiles[0].data;
  assert.deepStrictEqual(rest, v1);
  assert.deepStrictEqual(exp, M.defaultExp());
  assert.strictEqual(store.writes, 0);
});

test("v1.bak is used when v1 is missing or corrupt", () => {
  const v1 = makeV1();
  const r1 = M.loadFrom(makeStore({ [M.OLD_KEYS[1]]: JSON.stringify(v1) }));
  assert.strictEqual(r1.source, "v1bak");
  const r2 = M.loadFrom(makeStore({ [M.OLD_KEYS[0]]: "{broken", [M.OLD_KEYS[1]]: JSON.stringify(v1) }));
  assert.strictEqual(r2.source, "v1bak");
  assert.deepStrictEqual(r2.unusable, [{ key: M.OLD_KEYS[0], reason: "corrupt" }]);
});

test("v2 data wins over v1 data when both exist", () => {
  const r = M.loadFrom(makeStore({ [M.KEY]: JSON.stringify(ORIGINAL), [M.OLD_KEYS[0]]: JSON.stringify(makeV1()) }));
  assert.strictEqual(r.source, "main");
  assert.strictEqual(r.state.profiles.length, C.profiles);
});

/* ================= corrupted and empty stores ================= */
test("corrupted main store (truncated JSON) falls back to .bak and reports it", () => {
  const good = JSON.stringify(ORIGINAL);
  const store = makeStore({ [M.KEY]: good.slice(0, good.length >> 1), [M.BAK]: good });
  const before = store.snapshot();
  const r = M.loadFrom(store);
  assert.strictEqual(r.source, "bak");
  assert.deepStrictEqual(strip(r.state), ORIGINAL);
  assert.deepStrictEqual(r.unusable, [{ key: M.KEY, reason: "corrupt" }]);
  assert.strictEqual(store.snapshot(), before, "the corrupt value is left untouched, not overwritten");
});

test("main store with the wrong shape (valid JSON, not a state) falls back to .bak", () => {
  for (const bad of ["null", "[]", '"text"', "123", "true", '{"profiles":"x"}', '{"profiles":{}}', '{"foo":1}']) {
    const r = M.loadFrom(makeStore({ [M.KEY]: bad, [M.BAK]: JSON.stringify(ORIGINAL) }));
    assert.strictEqual(r.source, "bak", bad);
    assert.deepStrictEqual(r.unusable, [{ key: M.KEY, reason: "corrupt" }], bad);
  }
});

test("garbage bytes / HTML / half-written values are all survivable", () => {
  for (const bad of ["{", "}{", "\u0000\u0000", "<html>", "undefined", "NaN", "{\"profiles\":[{\"id\":", "﻿{}"]) {
    const r = M.loadFrom(makeStore({ [M.KEY]: bad, [M.BAK]: JSON.stringify(ORIGINAL) }));
    assert.strictEqual(r.source, "bak", JSON.stringify(bad));
    assert.strictEqual(r.state.profiles.length, C.profiles);
  }
});

test("empty main store ({\"profiles\":[]}) does not shadow a good .bak", () => {
  const store = makeStore({ [M.KEY]: '{"profiles":[]}', [M.BAK]: JSON.stringify(ORIGINAL) });
  const r = M.loadFrom(store);
  assert.strictEqual(r.source, "bak");
  assert.deepStrictEqual(r.unusable, [{ key: M.KEY, reason: "empty" }]);
  assert.strictEqual(r.state.profiles.length, C.profiles);
});

test("profiles array holding only junk counts as empty, not as data", () => {
  const r = M.loadFrom(makeStore({ [M.KEY]: '{"profiles":[null,1,"x"]}', [M.BAK]: JSON.stringify(ORIGINAL) }));
  assert.strictEqual(r.source, "bak");
});

test("main and .bak both corrupt, v1 intact: v1 is used and both failures are reported", () => {
  const v1 = makeV1();
  const r = M.loadFrom(makeStore({ [M.KEY]: "{{", [M.BAK]: "[", [M.OLD_KEYS[0]]: JSON.stringify(v1) }));
  assert.strictEqual(r.source, "v1");
  assert.deepStrictEqual(r.unusable.map(u => u.key), [M.KEY, M.BAK]);
});

test("everything corrupt: a fresh default state, with every unreadable key reported and nothing written", () => {
  const store = makeStore({ [M.KEY]: "{{", [M.BAK]: "[", [M.OLD_KEYS[0]]: "x", [M.OLD_KEYS[1]]: "{" });
  const before = store.snapshot();
  const r = M.loadFrom(store);
  assert.strictEqual(r.source, "empty");
  assert.deepStrictEqual(r.unusable.map(u => u.key), [M.KEY, M.BAK, M.OLD_KEYS[0], M.OLD_KEYS[1]]);
  assert.strictEqual(r.state.profiles.length, 1);
  assert.strictEqual(store.writes, 0);
  assert.strictEqual(store.snapshot(), before);
});

test("completely empty store: one default profile with seed data and the default exp, nothing reported", () => {
  const store = makeStore({});
  const r = M.loadFrom(store);
  assert.strictEqual(r.source, "empty");
  assert.deepStrictEqual(r.unusable, []);
  assert.strictEqual(r.migratedFrom, null);
  const st = r.state;
  assert.strictEqual(st.schemaVersion, M.SCHEMA_VERSION);
  assert.strictEqual(st.profiles.length, 1);
  assert.strictEqual(st.profiles[0].name, "الأساسي");
  assert.strictEqual(st.currentId, st.profiles[0].id);
  assert.strictEqual(st.profiles[0].data.blocks.length, 1);
  assert.strictEqual(st.profiles[0].data.blocks[0].title, "التزامات ثابتة");
  assert.deepStrictEqual(st.profiles[0].data.exp, M.defaultExp());
  assert.strictEqual(store.writes, 0);
});

test("empty-string and whitespace-free empty values behave like a missing key", () => {
  const r = M.loadFrom(makeStore({ [M.KEY]: "", [M.BAK]: "" }));
  assert.strictEqual(r.source, "empty");
  assert.deepStrictEqual(r.unusable, []);
});

test("a storage that throws on read (blocked / private mode) does not crash the loader", () => {
  const r = M.loadFrom({ getItem(){ throw new Error("SecurityError"); } });
  assert.strictEqual(r.source, "empty");
  assert.strictEqual(r.state.profiles.length, 1);
});

test("the default state is itself a fixed point of the migration", () => {
  const st = M.loadFrom(makeStore({})).state;
  assert.deepStrictEqual(M.sanitizeState(clone(st)), st);
});

test("the original budget-ledger code is byte-identical to index.backup.html", () => {
  const norm = s => s.replace(/\r\n/g, "\n");
  const backup = norm(fs.readFileSync(path.join(__dirname, "..", "index.backup.html"), "utf8"));
  const now = norm(html);
  const grab = (src, name) => {
    const i = src.indexOf("\nfunction " + name + "(");
    if (i < 0) return null;
    const j = src.indexOf("\n}\n", i);
    return src.slice(i, j + 3);
  };
  const names = ["normalizeDigits", "parseAmount", "formatValue", "canonicalRaw", "displayRaw", "bindAmount", "bindText",
                 "computeTotals", "setVal", "updateTotals", "renumberPlates", "renderRow", "receiptLayout", "drawReceipt"];
  for (const n of names) {
    const was = grab(backup, n), is = grab(now, n);
    assert.ok(was, n + " must exist in the backup");
    assert.strictEqual(is, was, n + " changed");
  }
});

console.log("\n" + pass + " passed" + (fail ? ", " + fail + " FAILED" : ""));
process.exit(fail ? 1 : 0);
