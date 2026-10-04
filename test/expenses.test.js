"use strict";
/* Expenses logic: amounts, labels, grouping, search, stats, merge, receipt model.
   Run: node test/expenses.test.js   (synthetic data only) */
const assert = require("assert");
const L = require("./blocks");
const { test, done } = L.runner("expenses");
const clone = v => JSON.parse(JSON.stringify(v));

const ent = (id, date, amount, categoryId, extra) => Object.assign({ id, date, amount, categoryId: categoryId || "cat_food", type: "expense", name: "", accountId: "acc_main", createdAt: 1 }, extra || {});
const cyc = (id, startDate, allowance, extra) => Object.assign({ id, startDate, allowance: allowance == null ? 1000 : allowance }, extra || {});

/* ---------- amounts ---------- */
test("amount input: Latin, Arabic-Indic and Persian digits, decimals, separators", () => {
  const p = L.parseEntryAmount;
  assert.strictEqual(p("46.25"), 46.25);
  assert.strictEqual(p("٤٦٫٢٥"), 46.25);          // Arabic-Indic digits + Arabic decimal separator
  assert.strictEqual(p("٤٦.٢٥"), 46.25);
  assert.strictEqual(p("۴۶٫۲۵"), 46.25);          // Persian digits
  assert.strictEqual(p("46,25"), 46.25);           // comma as decimal
  assert.strictEqual(p("46،5"), 46.5);             // Arabic comma
  assert.strictEqual(p("1,234.50"), 1234.5);
  assert.strictEqual(p("1,234"), 1234);
  assert.strictEqual(p("١٬٢٣٤٫٥"), 1234.5);
  assert.strictEqual(p(" 12 "), 12);
  assert.strictEqual(p(".5"), 0.5);
  assert.strictEqual(p("12."), 12);
  assert.strictEqual(p("0.004"), null);            // rounds to 0.00 -> rejected
  assert.strictEqual(p("0.005"), 0.01);             // half rounds up
  assert.strictEqual(p("10.456"), 10.46);
});
test("amount input: junk, zero, negatives and absurd values are rejected", () => {
  for (const bad of ["", "   ", null, undefined, "abc", "0", "0.00", "-5", "1.2.3", "12e3", "١٢أ", "9999999999", "--", "٫"]) {
    assert.strictEqual(L.parseEntryAmount(bad), null, JSON.stringify(bad));
  }
});
test("money formatting: Latin digits, 'د.إ' kept separate from the number", () => {
  assert.strictEqual(L.formatMoney(46.25), "46.25");
  assert.strictEqual(L.formatMoney(46), "46");
  assert.strictEqual(L.formatMoney(46.5), "46.50");
  assert.strictEqual(L.formatMoney(1234567.8), "1,234,567.80");
  assert.strictEqual(L.formatMoney(-20), "-20");
  assert.strictEqual(L.formatMoney(0.1 + 0.2), "0.30");
  assert.strictEqual(L.moneyText(46.25), "46.25 د.إ");
  assert.ok(!/[٠-٩]/.test(L.formatMoney(123456.78)));
});

/* ---------- labels ---------- */
test("day labels: اليوم / أمس / full Arabic date with Latin digits", () => {
  assert.strictEqual(L.dayLabel("2026-10-02", "2026-10-02"), "اليوم");
  assert.strictEqual(L.dayLabel("2026-10-01", "2026-10-02"), "أمس");
  assert.strictEqual(L.dayLabel("2026-10-03", "2026-10-02"), "غدًا");
  assert.strictEqual(L.dayLabel("2026-09-28", "2026-10-02"), "الاثنين 28 سبتمبر 2026");
  assert.strictEqual(L.fullArabicDate("2026-10-02"), "الجمعة 2 أكتوبر 2026");
  assert.ok(!/[٠-٩]/.test(L.fullArabicDate("2026-12-31")));
});
test("yesterday works across month and year ends", () => {
  assert.strictEqual(L.dayLabel("2026-02-28", "2026-03-01"), "أمس");
  assert.strictEqual(L.dayLabel("2026-12-31", "2027-01-01"), "أمس");
  assert.strictEqual(L.dayLabel("2028-02-29", "2028-03-01"), "أمس");
});
test("weekday is correct for known dates", () => {
  assert.strictEqual(L.weekdayIndex("1970-01-01"), 4);      // Thursday
  assert.strictEqual(L.weekdayIndex("2026-01-01"), 4);      // Thursday
  assert.strictEqual(L.weekdayIndex("2026-10-04"), 0);      // Sunday
  assert.strictEqual(L.weekdayIndex("1969-12-31"), 3);      // Wednesday (negative day numbers)
  assert.strictEqual(L.shortArabicDate("2026-09-02"), "2 سبتمبر");
  assert.strictEqual(L.shortArabicDate("2026-09-02", true), "2 سبتمبر 2026");
});

/* ---------- grouping, search, filter ---------- */
test("grouping: newest day first, day total = expenses only, income shown separately", () => {
  const list = [ent("a", "2026-10-01", 10), ent("b", "2026-10-02", 5.5), ent("c", "2026-10-02", 4.5),
                 ent("i", "2026-10-02", 100, "cat_other", { type: "income" }), ent("d", "2026-09-30", 1)];
  const g = L.groupByDay(list);
  assert.deepStrictEqual(g.map(d => d.date), ["2026-10-02", "2026-10-01", "2026-09-30"]);
  assert.strictEqual(g[0].spent, 10);
  assert.strictEqual(g[0].extra, 100);
  assert.strictEqual(g[0].entries.length, 3);
});
test("grouping: inside a day the newest entry is first and ordering is deterministic", () => {
  const list = [ent("a", "2026-10-02", 1, "x", { createdAt: 10 }), ent("b", "2026-10-02", 1, "x", { createdAt: 30 }), ent("c", "2026-10-02", 1, "x", { createdAt: 20 })];
  assert.deepStrictEqual(L.groupByDay(list)[0].entries.map(e => e.id), ["b", "c", "a"]);
  assert.deepStrictEqual(L.groupByDay(list.slice().reverse())[0].entries.map(e => e.id), ["b", "c", "a"]);
});
test("search by name or category (Arabic normalisation) and filter by category", () => {
  const names = { cat_food: "أكل ومطاعم", cat_coffee: "قهوة وكافيهات", cat_edu: "تعليم" };
  const cn = id => names[id] || "أخرى";
  const list = [ent("1", "2026-10-02", 5, "cat_coffee", { name: "لاتيه" }), ent("2", "2026-10-02", 9, "cat_food", { name: "غداء إدارة" }),
                ent("3", "2026-10-02", 7, "cat_edu", { name: "Course 101" })];
  const f = (q, c) => L.filterEntries(list, { query: q, categoryId: c }, cn).map(e => e.id);
  assert.deepStrictEqual(f("لاتيه"), ["1"]);
  assert.deepStrictEqual(f("قهوه"), ["1"], "ة and ه are the same when searching");
  assert.deepStrictEqual(f("اداره"), ["2"], "إ and ا are the same when searching");
  assert.deepStrictEqual(f("مطاعم"), ["2"], "matches the category name");
  assert.deepStrictEqual(f("course"), ["3"], "case-insensitive");
  assert.deepStrictEqual(f("١٠١"), ["3"], "Arabic-Indic digits match Latin digits");
  assert.deepStrictEqual(f("", "cat_edu"), ["3"]);
  assert.deepStrictEqual(f("غداء", "cat_edu"), []);
  assert.deepStrictEqual(f(""), ["1", "2", "3"]);
  assert.deepStrictEqual(f("لاتيهً"), ["1"], "tashkeel ignored");
});
test("entries pointing at a missing account are shown under the first account, never hidden", () => {
  const exp = { accounts: [{ id: "a1", name: "x", cycles: [] }, { id: "a2", name: "y", cycles: [] }], entries: [ent("1", "2026-01-01", 1, "c", { accountId: "gone" }), ent("2", "2026-01-01", 1, "c", { accountId: "a2" })] };
  assert.deepStrictEqual(L.accountEntries(exp, "a1").map(e => e.id), ["1"]);
  assert.deepStrictEqual(L.accountEntries(exp, "a2").map(e => e.id), ["2"]);
});
test("soft-deleted entries are separated from live ones", () => {
  const list = [ent("1", "2026-01-01", 1), ent("2", "2026-01-01", 1, "c", { deletedAt: 5 })];
  assert.deepStrictEqual(L.liveEntries(list).map(e => e.id), ["1"]);
  assert.deepStrictEqual(L.deletedEntries(list).map(e => e.id), ["2"]);
});
test("newEntry builds a clean record", () => {
  const e = L.newEntry({ type: "weird", amount: 5, name: "", categoryId: "cat_food", date: "2026-10-02", accountId: "acc_main" }, "id1", 123);
  assert.deepStrictEqual(e, { id: "id1", type: "expense", amount: 5, name: "", categoryId: "cat_food", date: "2026-10-02", accountId: "acc_main", createdAt: 123 });
});

/* ---------- stats ---------- */
test("category totals: biggest first, percentages are whole numbers adding to exactly 100", () => {
  const list = [ent("1", "2026-10-02", 100, "a"), ent("2", "2026-10-02", 100, "b"), ent("3", "2026-10-02", 100, "c"),
                ent("i", "2026-10-02", 999, "a", { type: "income" }), ent("d", "2026-10-02", 999, "a", { deletedAt: 1 })];
  const t = L.categoryTotals(list);
  assert.strictEqual(t.length, 3);
  assert.strictEqual(t.reduce((n, r) => n + r.pct, 0), 100);
  assert.deepStrictEqual(t.map(r => r.pct).sort(), [33, 33, 34]);
  assert.strictEqual(t[0].total, 100, "income and deleted entries are excluded");
  const t2 = L.categoryTotals([ent("1", "2026-10-02", 70, "a"), ent("2", "2026-10-02", 20, "b"), ent("3", "2026-10-02", 10, "c")]);
  assert.deepStrictEqual(t2.map(r => [r.categoryId, r.pct]), [["a", 70], ["b", 20], ["c", 10]]);
  assert.deepStrictEqual(L.categoryTotals([]), []);
});
test("category totals add up with awkward cents", () => {
  const list = [0.1, 0.2, 0.3, 0.7].map((v, i) => ent("e" + i, "2026-10-02", v, "k" + i));
  const t = L.categoryTotals(list);
  assert.strictEqual(t.reduce((n, r) => n + r.pct, 0), 100);
  assert.strictEqual(L.sumMoney(t.map(r => r.total)), 1.3);
});
test("last 7 days: one bar per day, never before the cycle start, expenses only", () => {
  const list = [ent("1", "2026-10-02", 10), ent("2", "2026-10-02", 5), ent("3", "2026-09-30", 7), ent("i", "2026-10-01", 50, "x", { type: "income" })];
  const d = L.lastDays(list, "2026-09-01", "2026-10-02", 7);
  assert.strictEqual(d.length, 7);
  assert.strictEqual(d[0].date, "2026-09-26");
  assert.strictEqual(d[6].date, "2026-10-02");
  assert.strictEqual(d[6].total, 15);
  assert.strictEqual(d[4].total, 7);
  assert.strictEqual(d[5].total, 0);
  const early = L.lastDays(list, "2026-09-30", "2026-10-02", 7);
  assert.deepStrictEqual(early.map(x => x.date), ["2026-09-30", "2026-10-01", "2026-10-02"]);
});
test("trend: totals of the last 6 cycles ending at the selected one, oldest first", () => {
  const cycles = ["01", "02", "03", "04", "05", "06", "07", "08"].map((m, i) => cyc("c" + (i + 1), "2026-" + m + "-10"));
  const list = cycles.map((c, i) => ent("e" + i, "2026-0" + (i + 1) + "-15", (i + 1) * 100));
  const t = L.cycleTrend(cycles, list, "c8", 6);
  assert.deepStrictEqual(t.map(x => x.id), ["c3", "c4", "c5", "c6", "c7", "c8"]);
  assert.deepStrictEqual(t.map(x => x.total), [300, 400, 500, 600, 700, 800]);
  assert.deepStrictEqual(L.cycleTrend(cycles, list, "c2", 6).map(x => x.id), ["c1", "c2"]);
  assert.deepStrictEqual(L.cycleTrend(cycles, list, "nope", 6), []);
});
test("category changes vs previous cycle: new / up / down, biggest first, none for the first cycle", () => {
  const cycles = [cyc("a", "2026-08-01"), cyc("b", "2026-09-01")];
  const list = [ent("1", "2026-08-05", 100, "food"), ent("2", "2026-08-06", 50, "fuel"), ent("3", "2026-08-07", 30, "gone"),
                ent("4", "2026-09-05", 160, "food"), ent("5", "2026-09-06", 50, "fuel"), ent("6", "2026-09-07", 80, "coffee")];
  const ch = L.categoryChanges(cycles, list, "b");
  assert.deepStrictEqual(ch.map(c => [c.categoryId, c.kind, c.delta]), [["coffee", "new", 80], ["food", "up", 60], ["gone", "down", -30]]);
  assert.deepStrictEqual(L.categoryChanges(cycles, list, "a"), []);
  assert.deepStrictEqual(L.categoryChanges(cycles, list, "zzz"), []);
});

/* ---------- receipt model ---------- */
test("receipt model: account, range, allowance, category totals, entries by day, spent, remaining", () => {
  const exp = L.defaultExp();
  exp.accounts[0].cycles = [cyc("a", "2026-09-02", 3000), cyc("b", "2026-10-02", 3200)];
  exp.entries = [ent("1", "2026-09-05", 40, "cat_food", { name: "غداء" }), ent("2", "2026-09-05", 10, "cat_coffee"),
                 ent("3", "2026-09-20", 100, "cat_food", { name: "عشاء" }), ent("i", "2026-09-21", 50, "cat_other", { type: "income", name: "مكافأة" }),
                 ent("x", "2026-09-22", 9, "cat_food", { deletedAt: 5 }), ent("n", "2026-10-03", 77)];
  const r = L.buildReceiptModel(exp, "acc_main", "a", "2026-10-05");
  assert.strictEqual(r.accountName, "مصاريفي");
  assert.strictEqual(r.start, "2026-09-02");
  assert.strictEqual(r.end, "2026-10-01");
  assert.strictEqual(r.allowance, 3000);
  assert.strictEqual(r.extra, 50);
  assert.strictEqual(r.spent, 150);
  assert.strictEqual(r.remaining, 2900);
  assert.deepStrictEqual(r.categories.map(c => [c.name, c.total, c.pct]), [["أكل ومطاعم", 140, 93], ["قهوة وكافيهات", 10, 7]]);
  assert.deepStrictEqual(r.days.map(d => d.date), ["2026-09-21", "2026-09-20", "2026-09-05"]);
  assert.ok(r.days[2].entries.some(e => e.name === "قهوة وكافيهات"), "name defaults to the category name");
  assert.ok(r.days[2].entries.some(e => e.name === "غداء"));
  assert.ok(!JSON.stringify(r).includes("77"), "entry from the next cycle is not included");
});
test("receipt model for the 'no cycle' group and for the open cycle", () => {
  const exp = L.defaultExp();
  exp.accounts[0].cycles = [cyc("a", "2026-09-02", 3000)];
  exp.entries = [ent("old", "2026-08-30", 25), ent("cur", "2026-09-03", 5)];
  const none = L.buildReceiptModel(exp, "acc_main", L.NO_CYCLE_KEY, "2026-09-10");
  assert.strictEqual(none.spent, 25);
  assert.strictEqual(none.start, null);
  const open = L.buildReceiptModel(exp, "acc_main", "a", "2026-09-10");
  assert.strictEqual(open.end, "2026-09-10", "open cycle ends today");
  assert.strictEqual(open.spent, 5);
});

/* ---------- counting / merging / importing ---------- */
function synth(){
  const st = L.sanitizeState({ currentId: "p1", profiles: [
    { id: "p1", name: "عبدالله", data: { monthLabel: "x", salaryLabel: "الراتب", salary: "1000",
        blocks: [{ id: "b1", title: "ثابتة", rows: [{ id: "r1", name: "إيجار", amount: "500", done: false }, { id: "r2", name: "", amount: "~20", done: true }] }] } },
    { id: "p2", name: "سارة", data: { blocks: [] } } ] });
  st.profiles[0].data.exp.accounts[0].cycles = [cyc("c1", "2026-09-02", 100)];
  st.profiles[0].data.exp.entries = [ent("e1", "2026-09-03", 5), ent("e2", "2026-09-04", 6, "cat_food", { deletedAt: 9 })];
  return st;
}
test("countState counts profiles, blocks, rows, accounts, cycles, live and deleted entries", () => {
  assert.deepStrictEqual(L.countState(synth()), { profiles: 2, blocks: 1, rows: 2, accounts: 2, cycles: 1, entries: 1, deleted: 1 });
  assert.deepStrictEqual(L.countState(null), { profiles: 0, blocks: 0, rows: 0, accounts: 0, cycles: 0, entries: 0, deleted: 0 });
});
test("contentScore: 0 for defaults, positive for any real content", () => {
  assert.strictEqual(L.contentScore(L.loadFrom({ getItem: () => null }).state), 0);
  assert.ok(L.contentScore(synth()) > 0);
  const s = L.loadFrom({ getItem: () => null }).state;
  s.profiles[0].data.salary = "100";
  assert.ok(L.contentScore(s) > 0);
  const t = L.loadFrom({ getItem: () => null }).state;
  t.profiles[0].data.exp.entries.push(ent("e", "2026-01-01", 1));
  assert.ok(L.contentScore(t) > 0);
  const u = L.loadFrom({ getItem: () => null }).state;
  u.profiles[0].data.exp.categories.push({ id: "mine", name: "قطتي", emoji: "🐈", hidden: false });
  assert.ok(L.contentScore(u) > 0);
  assert.strictEqual(L.contentScore(null), 0);
  assert.strictEqual(L.contentScore({ profiles: "x" }), 0);
});
test("merge: current wins, missing things are added, nothing is removed, same input twice is stable", () => {
  const cur = synth();
  const inc = synth();
  inc.profiles[0].data.salary = "9999";                                           // conflicting value: current wins
  inc.profiles[0].data.blocks[0].rows.push({ id: "r3", name: "جديد", amount: "7", done: false });
  inc.profiles[0].data.blocks[0].rows[0].amount = "1";
  inc.profiles[0].data.blocks.push({ id: "b2", title: "كتلة", rows: [] });
  inc.profiles[0].data.exp.entries.push(ent("e3", "2026-09-05", 8));
  inc.profiles[0].data.exp.accounts.push({ id: "acc_x", name: "سفر", archived: false, cycles: [cyc("cx", "2026-01-01", 5)] });
  inc.profiles[0].data.exp.categories.push({ id: "cat_new", name: "جديدة", emoji: "🐈", hidden: false });
  inc.profiles.push({ id: "p3", name: "ثالث", data: { blocks: [] } });
  const m = L.mergeStates(cur, inc);
  const p = m.profiles.find(x => x.id === "p1").data;
  assert.strictEqual(p.salary, "1000");
  assert.strictEqual(p.blocks.length, 2);
  assert.strictEqual(p.blocks[0].rows.length, 3);
  assert.strictEqual(p.blocks[0].rows[0].amount, "500");
  assert.deepStrictEqual(p.exp.entries.map(e => e.id).sort(), ["e1", "e2", "e3"]);
  assert.strictEqual(p.exp.accounts.length, 2);
  assert.ok(p.exp.categories.some(c => c.id === "cat_new"));
  assert.strictEqual(m.profiles.length, 3);
  const before = L.countState(cur);
  const after = L.countState(m);
  for (const k of Object.keys(before)) assert.ok(after[k] >= before[k], k + " must not shrink");
  assert.deepStrictEqual(L.mergeStates(m, inc), m, "merging the same file again changes nothing");
  assert.deepStrictEqual(L.mergeStates(cur, cur), L.sanitizeState(cur), "merging with itself is a no-op");
});
test("merge never adds a second cycle on a date that already exists", () => {
  const cur = synth();
  const inc = synth();
  inc.profiles[0].data.exp.accounts[0].cycles = [cyc("other-id", "2026-09-02", 5)];
  const m = L.mergeStates(cur, inc);
  assert.strictEqual(m.profiles[0].data.exp.accounts[0].cycles.length, 1);
});
test("parseImport recognises new, old multi-profile and old single-person files, and rejects junk", () => {
  const st = synth();
  const a = L.parseImport(JSON.stringify(st));
  assert.ok(a.ok && a.kind === "state");
  assert.strictEqual(a.counts.profiles, 2);
  const old = clone(st); delete old.schemaVersion; for (const p of old.profiles) delete p.data.exp;
  const b = L.parseImport(JSON.stringify(old));
  assert.ok(b.ok && b.kind === "state" && b.counts.entries === 0 && b.counts.rows === 2);
  const c = L.parseImport(JSON.stringify(old.profiles[0].data));
  assert.ok(c.ok && c.kind === "single" && c.counts.blocks === 1 && c.counts.rows === 2);
  for (const bad of ["", "not json", "[]", "null", "42", '{"foo":1}', '{"profiles":[]}', '{"profiles":[1,2]}']) {
    assert.strictEqual(L.parseImport(bad).ok, false, bad);
  }
  assert.strictEqual(L.parseImport(JSON.stringify(Object.assign(clone(st), { schemaVersion: 99 }))).newer, true);
});

test("movedEntryCount: how many entries change cycle when a cycle date is edited", () => {
  const cycles = [cyc("a", "2026-01-27"), cyc("b", "2026-02-27")];
  const list = [ent("1", "2026-02-20", 1), ent("2", "2026-02-25", 1), ent("3", "2026-02-28", 1)];
  assert.strictEqual(L.movedEntryCount(cycles, list, "b", "2026-02-24"), 1);
  assert.strictEqual(L.movedEntryCount(cycles, list, "b", "2026-02-27"), 0);
  assert.strictEqual(L.movedEntryCount(cycles, list, "b", "2026-03-15"), 1);
  assert.strictEqual(L.movedEntryCount(cycles, list, "a", "2026-02-22"), 1, "first cycle moving later pushes early entries to no-cycle");
  assert.strictEqual(L.movedEntryCount(cycles, list, "b", "2026-01-27"), 0, "duplicate date is rejected, so nothing moves");
  assert.strictEqual(L.movedEntryCount(cycles, list, "zzz", "2026-02-24"), 0);
});
test("replace import keeps existing Expenses data when the old file had none, and takes the file's when it has it", () => {
  const cur = synth();
  const oldFile = clone(cur); delete oldFile.schemaVersion;
  for (const p of oldFile.profiles) delete p.data.exp;
  oldFile.profiles[0].data.salary = "7777";
  const r = L.replaceKeepingExp(cur, oldFile);
  assert.strictEqual(r.profiles[0].data.salary, "7777", "ledger comes from the file");
  assert.deepStrictEqual(r.profiles[0].data.exp, cur.profiles[0].data.exp, "expenses kept");
  const newFile = clone(cur); newFile.profiles[0].data.exp.entries = [];
  assert.strictEqual(L.replaceKeepingExp(cur, newFile).profiles[0].data.exp.entries.length, 0, "a new-format file is authoritative");
  const other = clone(oldFile); other.profiles[1].id = "brand-new";
  const r2 = L.replaceKeepingExp(cur, other);
  assert.deepStrictEqual(r2.profiles[1].data.exp, L.defaultExp(), "unknown profile gets defaults");
});

test("chartNum: compact Latin labels for chart values", () => {
  assert.strictEqual(L.chartNum(0), "0");
  assert.strictEqual(L.chartNum(46.25), "46");
  assert.strictEqual(L.chartNum(7.5), "8");
  assert.strictEqual(L.chartNum(999), "999");
  assert.strictEqual(L.chartNum(999.6), "1K");
  assert.strictEqual(L.chartNum(1000), "1K");
  assert.strictEqual(L.chartNum(1250), "1.3K");
  assert.strictEqual(L.chartNum(12400), "12.4K");
  assert.strictEqual(L.chartNum(10000), "10K", "a whole number ending in 0 must keep its digits");
  assert.strictEqual(L.chartNum(20000), "20K");
  assert.strictEqual(L.chartNum(100000), "100K");
  assert.strictEqual(L.chartNum(-20), "-20");
  assert.strictEqual(L.chartNum(-0.2), "0");
  assert.strictEqual(L.chartNum(undefined), "0");
  assert.ok(!/[٠-٩]/.test(L.chartNum(123456)));
});
test("smoothPath: starts and ends on the data points, one curve per gap, and stays inside the plot", () => {
  assert.strictEqual(L.smoothPath([], 0, 100), "");
  assert.strictEqual(L.smoothPath([[10, 50]], 0, 100), "M10 50");
  const pts = [[0, 90], [50, 10], [100, 95], [150, 20], [200, 60]];
  const d = L.smoothPath(pts, 10, 95);
  assert.ok(d.startsWith("M0 90"));
  assert.ok(d.endsWith(" 200 60"));
  assert.strictEqual((d.match(/C/g) || []).length, pts.length - 1);
  const nums = d.replace(/[MC]/g, " ").trim().split(/\s+/).map(Number);
  assert.ok(nums.every(n => isFinite(n)));
  for (let i = 1; i < nums.length; i += 2) assert.ok(nums[i] >= 10 && nums[i] <= 95, "y " + nums[i] + " must stay in [10, 95]");
  /* an extreme spike must not overshoot the baseline */
  const spike = L.smoothPath([[0, 100], [10, 0], [20, 100]], 0, 100).replace(/[MC]/g, " ").trim().split(/\s+/).map(Number);
  for (let i = 1; i < spike.length; i += 2) assert.ok(spike[i] >= 0 && spike[i] <= 100);
  assert.strictEqual(L.smoothPath([[0, 5], [10, 5]], 0, 10), "M0 5 C1.67 5 8.33 5 10 5");
});

test("canSaveEntry: needs an amount above zero, a category and a non-empty description", () => {
  const ok = { amount: "46.25", categoryId: "cat_food", name: "غدا" };
  assert.strictEqual(L.canSaveEntry(ok), true);
  assert.strictEqual(L.canSaveEntry(Object.assign({}, ok, { amount: "٤٦٫٢٥" })), true, "Arabic-Indic digits count");
  assert.strictEqual(L.canSaveEntry(Object.assign({}, ok, { amount: 12 })), true);
  for (const amount of ["", "0", "٠", "0.00", "0.004", "-5", "abc", null, undefined])
    assert.strictEqual(L.canSaveEntry(Object.assign({}, ok, { amount })), false, "amount " + JSON.stringify(amount));
  for (const categoryId of [null, undefined, ""])
    assert.strictEqual(L.canSaveEntry(Object.assign({}, ok, { categoryId })), false, "category " + JSON.stringify(categoryId));
  for (const name of ["", "   ", "\t \n", null, undefined, 5])
    assert.strictEqual(L.canSaveEntry(Object.assign({}, ok, { name })), false, "name " + JSON.stringify(name));
  assert.strictEqual(L.canSaveEntry(Object.assign({}, ok, { name: "  عشا  " })), true, "padding is fine, content is what counts");
  assert.strictEqual(L.canSaveEntry(null), false);
  assert.strictEqual(L.canSaveEntry({}), false);
});
test("suggestNames: most used names for the category first, ties by most recent use", () => {
  const e = (name, date, cat, extra) => Object.assign({ id: name + date, name, date, categoryId: cat || "cat_coffee", type: "expense", amount: 5, createdAt: Date.parse(date + "T10:00:00Z") }, extra || {});
  const list = [e("لاتيه", "2026-09-01"), e("لاتيه", "2026-09-05"), e("لاتيه", "2026-09-09"),
                e("اسبريسو", "2026-09-02"), e("اسبريسو", "2026-09-08"),
                e("شاي", "2026-09-03"), e("كابتشينو", "2026-09-10"),
                e("موكا", "2026-08-01")];
  assert.deepStrictEqual(L.suggestNames(list, "cat_coffee"), ["لاتيه", "اسبريسو", "كابتشينو", "شاي"], "count, then recency (كابتشينو is newer than شاي)");
  assert.deepStrictEqual(L.suggestNames(list, "cat_coffee", 2), ["لاتيه", "اسبريسو"]);
  assert.strictEqual(L.suggestNames(list, "cat_coffee").length, 4, "at most four by default");
  assert.deepStrictEqual(L.suggestNames(list, "cat_coffee", 10).length, 5);
});
test("suggestNames: other categories, deleted entries and empty names are ignored; spelling variants merge", () => {
  const e = (name, date, extra) => Object.assign({ id: name + date, name, date, categoryId: "cat_food", type: "expense", amount: 5, createdAt: 1 }, extra || {});
  const list = [e("غداء", "2026-09-01"), e("غداء", "2026-09-02", { deletedAt: 9 }), e("  ", "2026-09-03"), e("", "2026-09-03"), e(undefined, "2026-09-03"),
                e("مطعم", "2026-09-04", { categoryId: "cat_fun" }), e("إفطار", "2026-09-05"), e("افطار", "2026-09-06"), e("ٱفطار", "2026-09-07")];
  assert.deepStrictEqual(L.suggestNames(list, "cat_food"), ["ٱفطار", "غداء"], "three افطار spellings are one name, shown as the latest spelling");
  assert.deepStrictEqual(L.suggestNames(list, "cat_fun"), ["مطعم"]);
  assert.deepStrictEqual(L.suggestNames(list, "cat_kids"), [], "no history and no starter names");
  assert.deepStrictEqual(L.suggestNames(null, "cat_kids"), []);
});
test("suggestNames: with no history, food gets the starter names; history replaces them; the input is not changed", () => {
  assert.deepStrictEqual(L.suggestNames([], "cat_food"), ["ريوق", "غدا", "عشا"]);
  assert.deepStrictEqual(L.suggestNames([], "cat_food", 2), ["ريوق", "غدا"]);
  const only = [{ id: "1", name: "شاورما", date: "2026-09-01", categoryId: "cat_food", type: "expense", amount: 9 }];
  assert.deepStrictEqual(L.suggestNames(only, "cat_food"), ["شاورما"], "once there is history, the starter names step aside");
  const frozen = JSON.parse(JSON.stringify(only)); Object.freeze(frozen); frozen.forEach(Object.freeze);
  assert.deepStrictEqual(L.suggestNames(frozen, "cat_food"), ["شاورما"]);
  assert.deepStrictEqual(L.suggestNames([{ id: "d", name: "غدا", categoryId: "cat_food", date: "2026-09-01", deletedAt: 1 }], "cat_food"), ["ريوق", "غدا", "عشا"], "deleted history does not count");
});
test("suggestNames: full ties fall back to alphabetical order so the chips never shuffle", () => {
  const e = (name) => ({ id: name, name, date: "2026-09-01", categoryId: "cat_gifts", type: "expense", amount: 1, createdAt: 5 });
  const a = L.suggestNames([e("ب"), e("ا"), e("ج")], "cat_gifts");
  const b = L.suggestNames([e("ج"), e("ب"), e("ا")], "cat_gifts");
  assert.deepStrictEqual(a, b);
});

done();
