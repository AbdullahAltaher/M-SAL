"use strict";
/* Tests for the salary-cycle logic in index.html.
   Run:  node test/cycles.test.js
   The logic is extracted verbatim from the @@CYCLE-LOGIC block of index.html, so the
   tests exercise the exact code the app runs. The suite re-runs itself under several
   time zones (including UTC+4) because date bugs only show up away from UTC. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { spawnSync } = require("child_process");

const ZONES = ["Asia/Dubai", "UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"];

if (!process.argv.includes("--child")) {
  let failed = false;
  for (const tz of ZONES) {
    const r = spawnSync(process.execPath, [__filename, "--child"], {
      env: Object.assign({}, process.env, { TZ: tz }), encoding: "utf8"
    });
    process.stdout.write(r.stdout || "");
    process.stderr.write(r.stderr || "");
    if (r.status !== 0) failed = true;
  }
  console.log(failed ? "\nFAILED" : "\nALL ZONES PASSED (" + ZONES.join(", ") + ")");
  process.exit(failed ? 1 : 0);
}

/* ---------- load the logic block ---------- */
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = /\/\* @@CYCLE-LOGIC-BEGIN[\s\S]*?\/\* @@CYCLE-LOGIC-END \*\//.exec(html);
if (!m) { console.error("cycle logic block not found in index.html"); process.exit(2); }
const BLOCK = m[0];
const L = new Function(BLOCK + `
  return { parseDate, isValidDate, dayNumber, addDays, daysBetween, localDateStr, todayStr,
           sortCycles, cycleForDate, cycleBounds, bucketEntries, validateCycleDate,
           addCycle, setCycleDate, prefillNewCycle, cycleSummary, sumMoney, roundMoney };`)();

/* ---------- tiny runner ---------- */
const tz = process.env.TZ;
let pass = 0, fail = 0;
function test(name, fn){
  try { fn(); pass++; }
  catch (e) { fail++; console.log("  FAIL [" + tz + "] " + name + "\n       " + String(e.message).split("\n").join("\n       ")); }
}
const cyc = (id, startDate, allowance, extra) => Object.assign({ id, startDate, allowance: allowance == null ? 1000 : allowance }, extra || {});
const exp = (id, date, amount, extra) => Object.assign({ id, date, amount, type: "expense" }, extra || {});
const ids = list => list.map(e => e.id);

/* ---------- date helpers ---------- */
test("parseDate accepts real dates and rejects impossible ones", () => {
  assert.deepStrictEqual(L.parseDate("2026-02-28"), { y: 2026, m: 2, d: 28 });
  for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-1-5", "26-01-01", "", null, undefined, 20260101, "2026-04-31", "2025-02-29"]) {
    assert.strictEqual(L.parseDate(bad), null, String(bad));
  }
  assert.ok(L.parseDate("2028-02-29"), "leap day is valid");
});

test("addDays crosses month ends, year ends and leap days", () => {
  assert.strictEqual(L.addDays("2026-01-31", 1), "2026-02-01");
  assert.strictEqual(L.addDays("2026-02-28", 1), "2026-03-01");
  assert.strictEqual(L.addDays("2028-02-28", 1), "2028-02-29");
  assert.strictEqual(L.addDays("2028-02-29", 1), "2028-03-01");
  assert.strictEqual(L.addDays("2026-12-31", 1), "2027-01-01");
  assert.strictEqual(L.addDays("2027-01-01", -1), "2026-12-31");
  assert.strictEqual(L.addDays("2026-03-01", -1), "2026-02-28");
  assert.strictEqual(L.addDays("2026-05-15", 0), "2026-05-15");
});

test("daysBetween is exact across month ends, leap years and DST changes", () => {
  assert.strictEqual(L.daysBetween("2026-01-31", "2026-02-01"), 1);
  assert.strictEqual(L.daysBetween("2026-01-27", "2026-02-27"), 31);
  assert.strictEqual(L.daysBetween("2028-02-01", "2028-03-01"), 29);
  assert.strictEqual(L.daysBetween("2026-02-01", "2026-03-01"), 28);
  assert.strictEqual(L.daysBetween("2026-12-27", "2027-01-27"), 31);
  assert.strictEqual(L.daysBetween("2026-03-07", "2026-03-10"), 3);   // US spring-forward on Mar 8
  assert.strictEqual(L.daysBetween("2026-10-31", "2026-11-02"), 2);   // US fall-back on Nov 1
  assert.strictEqual(L.daysBetween("2026-05-05", "2026-05-05"), 0);
  assert.strictEqual(L.daysBetween("2026-05-10", "2026-05-05"), -5);
});

/* ---------- the UTC+4 midnight bug ---------- */
test("localDateStr uses LOCAL components: just after midnight stays on the new day", () => {
  const justAfter = new Date(2026, 9, 2, 0, 30, 0);      // 00:30 local on 2 Oct 2026
  assert.strictEqual(L.localDateStr(justAfter), "2026-10-02");
  assert.strictEqual(L.todayStr(justAfter), "2026-10-02");
  assert.strictEqual(L.localDateStr(new Date(2026, 9, 2, 0, 0, 0)), "2026-10-02");
  assert.strictEqual(L.localDateStr(new Date(2026, 9, 2, 23, 59, 59)), "2026-10-02");
  assert.strictEqual(L.localDateStr(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
  assert.strictEqual(L.localDateStr(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
});

test("the naive toISOString approach really is wrong in UTC+4 (this is why it is banned)", () => {
  const justAfter = new Date(2026, 9, 2, 0, 30, 0);
  const naive = justAfter.toISOString().slice(0, 10);
  if (tz === "Asia/Dubai") {
    assert.strictEqual(naive, "2026-10-01", "expected the off-by-one day in UTC+4");
    assert.notStrictEqual(naive, L.localDateStr(justAfter));
  } else if (tz === "America/Los_Angeles") {
    const evening = new Date(2026, 9, 2, 20, 0, 0);       // evening in UTC-7 is already tomorrow in UTC
    assert.strictEqual(evening.toISOString().slice(0, 10), "2026-10-03");
    assert.strictEqual(L.localDateStr(evening), "2026-10-02");
  }
});

test("an expense entered at 00:30 lands in the cycle that starts today, not the previous one", () => {
  const cycles = [cyc("a", "2026-09-02"), cyc("b", "2026-10-02")];
  const now = new Date(2026, 9, 2, 0, 30, 0);
  const e = exp("x", L.todayStr(now), 12.5);
  assert.strictEqual(L.cycleForDate(cycles, e.date).id, "b");
});

test("logic block never uses toISOString / getUTC for 'today' or local dates", () => {
  const code = BLOCK.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/toISOString/.test(code), "toISOString found in logic block");
  assert.ok(!/Date\.now|new Date\(\)\.get/.test(code.replace(/now \|\| new Date\(\)/, "")), "implicit clock use");
});

/* ---------- boundaries ---------- */
test("expense exactly on a cycle boundary belongs to the NEW cycle (end exclusive)", () => {
  const cycles = [cyc("a", "2026-01-27"), cyc("b", "2026-02-27")];
  const b = L.bucketEntries(cycles, [
    exp("last", "2026-02-26", 1), exp("boundary", "2026-02-27", 2), exp("first", "2026-01-27", 3)
  ]);
  assert.deepStrictEqual(ids(b.byCycle.a).sort(), ["first", "last"]);
  assert.deepStrictEqual(ids(b.byCycle.b), ["boundary"]);
  assert.strictEqual(b.noCycle.length, 0);
});

test("cycleBounds: closed cycle ends the day before the next start; latest is open", () => {
  const cycles = [cyc("b", "2026-02-27"), cyc("a", "2026-01-27")];   // deliberately unsorted
  const ba = L.cycleBounds(cycles, cycles[1]);
  assert.deepStrictEqual(ba, { start: "2026-01-27", endExclusive: "2026-02-27", lastDay: "2026-02-26", open: false });
  const bb = L.cycleBounds(cycles, cycles[0]);
  assert.deepStrictEqual(bb, { start: "2026-02-27", endExclusive: null, lastDay: null, open: true });
});

test("a cycle's own first day counts, and so does the day before the next salary", () => {
  const cycles = [cyc("a", "2026-03-01"), cyc("b", "2026-03-31")];
  assert.strictEqual(L.cycleForDate(cycles, "2026-03-01").id, "a");
  assert.strictEqual(L.cycleForDate(cycles, "2026-03-30").id, "a");
  assert.strictEqual(L.cycleForDate(cycles, "2026-03-31").id, "b");
  assert.strictEqual(L.cycleForDate(cycles, "2030-01-01").id, "b");   // open cycle has no upper limit
});

/* ---------- editing a cycle date re-buckets ---------- */
test("editing a cycle date re-buckets expenses automatically (nothing stored on the entry)", () => {
  let cycles = [cyc("a", "2026-01-27"), cyc("b", "2026-02-27")];
  const entries = [exp("e1", "2026-02-20", 10), exp("e2", "2026-02-25", 20), exp("e3", "2026-02-28", 30)];
  const snapshot = JSON.stringify(entries);
  let b = L.bucketEntries(cycles, entries);
  assert.deepStrictEqual(ids(b.byCycle.a), ["e1", "e2"]);
  assert.deepStrictEqual(ids(b.byCycle.b), ["e3"]);

  const r = L.setCycleDate(cycles, "b", "2026-02-24");          // salary actually arrived earlier
  assert.ok(r.ok);
  cycles = r.cycles;
  b = L.bucketEntries(cycles, entries);
  assert.deepStrictEqual(ids(b.byCycle.a), ["e1"]);
  assert.deepStrictEqual(ids(b.byCycle.b), ["e2", "e3"]);
  assert.strictEqual(JSON.stringify(entries), snapshot, "entries must not be modified");
  assert.ok(entries.every(e => !("cycleId" in e)));

  cycles = L.setCycleDate(cycles, "b", "2026-03-15").cycles;     // and later
  b = L.bucketEntries(cycles, entries);
  assert.deepStrictEqual(ids(b.byCycle.a), ["e1", "e2", "e3"]);
  assert.deepStrictEqual(ids(b.byCycle.b), []);
});

test("editing the FIRST cycle's date moves entries in or out of the 'no cycle' group", () => {
  let cycles = [cyc("a", "2026-02-10")];
  const entries = [exp("e1", "2026-02-05", 5), exp("e2", "2026-02-12", 6)];
  let b = L.bucketEntries(cycles, entries);
  assert.deepStrictEqual(ids(b.noCycle), ["e1"]);
  cycles = L.setCycleDate(cycles, "a", "2026-02-01").cycles;
  b = L.bucketEntries(cycles, entries);
  assert.deepStrictEqual(ids(b.noCycle), []);
  assert.deepStrictEqual(ids(b.byCycle.a), ["e1", "e2"]);
});

test("setCycleDate does not mutate its input, and reports unknown ids", () => {
  const cycles = [cyc("a", "2026-01-27")];
  const before = JSON.stringify(cycles);
  const r = L.setCycleDate(cycles, "a", "2026-01-28");
  assert.strictEqual(JSON.stringify(cycles), before);
  assert.strictEqual(r.cycles[0].startDate, "2026-01-28");
  assert.deepStrictEqual(L.setCycleDate(cycles, "zzz", "2026-01-28"), { ok: false, error: "notfound" });
});

test("cycle edit keeps unknown fields on the cycle", () => {
  const cycles = [cyc("a", "2026-01-27", 500, { futureField: { x: 1 }, expectedNextSalaryDate: "2026-02-27" })];
  const r = L.setCycleDate(cycles, "a", "2026-01-28");
  assert.deepStrictEqual(r.cycles[0].futureField, { x: 1 });
  assert.strictEqual(r.cycles[0].expectedNextSalaryDate, "2026-02-27");
});

/* ---------- before the first cycle ---------- */
test("expense before the earliest cycle goes to 'no cycle', never to a cycle", () => {
  const cycles = [cyc("a", "2026-03-05"), cyc("b", "2026-04-05")];
  const b = L.bucketEntries(cycles, [exp("old", "2026-03-04", 9), exp("older", "2020-01-01", 1), exp("ok", "2026-03-05", 2)]);
  assert.deepStrictEqual(ids(b.noCycle).sort(), ["old", "older"]);
  assert.deepStrictEqual(ids(b.byCycle.a), ["ok"]);
  assert.strictEqual(L.cycleForDate(cycles, "2026-03-04"), null);
});

test("with no cycles at all, every entry is 'no cycle' and nothing is lost", () => {
  const entries = [exp("1", "2026-05-01", 1), exp("2", "2026-05-02", 2)];
  const b = L.bucketEntries([], entries);
  assert.strictEqual(b.noCycle.length, 2);
  assert.deepStrictEqual(b.byCycle, {});
});

test("entries with a broken date are kept in 'invalid', not dropped", () => {
  const cycles = [cyc("a", "2026-01-01")];
  const bad = [exp("x", "2026-02-30", 1), exp("y", "garbage", 1), exp("z", undefined, 1)];
  const b = L.bucketEntries(cycles, bad.concat([exp("ok", "2026-01-02", 1)]));
  assert.strictEqual(b.invalid.length, 3);
  assert.deepStrictEqual(ids(b.byCycle.a), ["ok"]);
  assert.strictEqual(b.invalid.length + b.noCycle.length + b.byCycle.a.length, 4);
});

/* ---------- two cycles on the same date ---------- */
test("two cycles on the same date are rejected when adding", () => {
  const cycles = [cyc("a", "2026-05-27")];
  const r = L.addCycle(cycles, cyc("b", "2026-05-27"));
  assert.deepStrictEqual(r, { ok: false, error: "duplicate" });
  assert.strictEqual(cycles.length, 1);
});

test("two cycles on the same date are rejected when editing a date, but re-saving the same date is fine", () => {
  const cycles = [cyc("a", "2026-04-27"), cyc("b", "2026-05-27")];
  assert.deepStrictEqual(L.setCycleDate(cycles, "b", "2026-04-27"), { ok: false, error: "duplicate" });
  assert.ok(L.setCycleDate(cycles, "b", "2026-05-27").ok, "unchanged date must not clash with itself");
});

test("invalid dates are rejected when adding or editing", () => {
  const cycles = [cyc("a", "2026-04-27")];
  assert.deepStrictEqual(L.addCycle(cycles, cyc("b", "2026-02-30")), { ok: false, error: "invalid" });
  assert.deepStrictEqual(L.addCycle(cycles, cyc("b", "")), { ok: false, error: "invalid" });
  assert.deepStrictEqual(L.setCycleDate(cycles, "a", "nope"), { ok: false, error: "invalid" });
});

test("if imported data already has duplicate dates, bucketing is still deterministic and loses nothing", () => {
  const cycles = [cyc("z", "2026-06-01"), cyc("a", "2026-06-01")];
  const entries = [exp("e", "2026-06-05", 1), exp("f", "2026-05-31", 1)];
  const b1 = L.bucketEntries(cycles, entries);
  const b2 = L.bucketEntries(cycles.slice().reverse(), entries);
  assert.deepStrictEqual(b1, b2);
  assert.strictEqual(b1.byCycle.z.length + b1.byCycle.a.length, 1);
  assert.deepStrictEqual(ids(b1.noCycle), ["f"]);
});

test("addCycle / prefill: allowance prefilled from the latest cycle, date defaults to today", () => {
  const cycles = [cyc("b", "2026-02-27", 4000), cyc("a", "2026-01-27", 3000)];
  assert.deepStrictEqual(L.prefillNewCycle(cycles, "2026-03-27"), { startDate: "2026-03-27", allowance: 4000 });
  assert.deepStrictEqual(L.prefillNewCycle([], "2026-03-27"), { startDate: "2026-03-27", allowance: 0 });
  const r = L.addCycle(cycles, { id: "c", startDate: "2026-03-27", allowance: "4000.456" });
  assert.ok(r.ok);
  assert.strictEqual(r.cycles.length, 3);
  assert.strictEqual(r.cycles[2].allowance, 4000.46);
});

/* ---------- month-end crossings ---------- */
test("cycles starting on the 31st / 28th / 29th cross month ends correctly", () => {
  const cycles = [cyc("a", "2026-01-31"), cyc("b", "2026-02-28"), cyc("c", "2026-03-31")];
  assert.strictEqual(L.cycleForDate(cycles, "2026-02-27").id, "a");
  assert.strictEqual(L.cycleForDate(cycles, "2026-02-28").id, "b");
  assert.strictEqual(L.cycleForDate(cycles, "2026-03-30").id, "b");
  assert.strictEqual(L.cycleForDate(cycles, "2026-03-31").id, "c");
  assert.strictEqual(L.cycleBounds(cycles, cycles[0]).lastDay, "2026-02-27");
  assert.strictEqual(L.cycleBounds(cycles, cycles[1]).lastDay, "2026-03-30");
});

test("a cycle can span the calendar month boundary without 'rolling over'", () => {
  const cycles = [cyc("a", "2026-01-27")];
  for (const d of ["2026-01-31", "2026-02-01", "2026-02-15", "2026-03-01", "2026-12-31", "2027-06-01"]) {
    assert.strictEqual(L.cycleForDate(cycles, d).id, "a", d);
  }
});

test("year-end crossing and leap-year February", () => {
  const cycles = [cyc("a", "2026-12-25"), cyc("b", "2027-01-25"), cyc("c", "2028-02-29"), cyc("d", "2028-03-01")];
  assert.strictEqual(L.cycleForDate(cycles, "2027-01-24").id, "a");
  assert.strictEqual(L.cycleForDate(cycles, "2027-01-01").id, "a");
  assert.strictEqual(L.cycleForDate(cycles, "2028-02-28").id, "b");
  assert.strictEqual(L.cycleForDate(cycles, "2028-02-29").id, "c");
  assert.strictEqual(L.cycleForDate(cycles, "2028-03-01").id, "d");
  const s = L.cycleSummary(cycles, cycles[2], [], "2028-03-05");
  assert.strictEqual(s.totalDays, 1);
  assert.strictEqual(s.daysElapsed, 1);
  const s2 = L.cycleSummary(cycles, cycles[0], [], "2028-03-05");
  assert.strictEqual(s2.totalDays, 31);
});

test("cycleForDate rejects an invalid date instead of guessing", () => {
  assert.strictEqual(L.cycleForDate([cyc("a", "2026-01-01")], "2026-02-30"), null);
});

/* ---------- summary figures ---------- */
test("summary: remaining = allowance + extra income - expenses; soft-deleted entries ignored", () => {
  const cycles = [cyc("a", "2026-05-01", 1000, { expectedNextSalaryDate: "2026-05-31" })];
  const entries = [
    exp("1", "2026-05-02", 100.10), exp("2", "2026-05-02", 200.20), exp("3", "2026-05-03", 0.30),
    { id: "inc", type: "income", date: "2026-05-04", amount: 50 },
    exp("del", "2026-05-04", 999, { deletedAt: 12345 })
  ];
  const s = L.cycleSummary(cycles, cycles[0], entries, "2026-05-10");
  assert.strictEqual(s.spent, 300.6);                  // 100.10 + 200.20 + 0.30 with no float drift
  assert.strictEqual(s.extra, 50);
  assert.strictEqual(s.remaining, 749.4);
  assert.strictEqual(s.entryCount, 4);
  assert.strictEqual(s.over, false);
});

test("summary: spent today, days elapsed, days left and 'can spend today'", () => {
  const cycles = [cyc("a", "2026-05-01", 1000, { expectedNextSalaryDate: "2026-05-31" })];
  const entries = [exp("1", "2026-05-10", 40), exp("2", "2026-05-10", 6.25), exp("3", "2026-05-09", 100)];
  const s = L.cycleSummary(cycles, cycles[0], entries, "2026-05-10");
  assert.strictEqual(s.spentToday, 46.25);
  assert.strictEqual(s.daysElapsed, 10);
  assert.strictEqual(s.totalDays, 30);
  assert.strictEqual(s.daysLeft, 21);
  assert.strictEqual(s.remaining, 853.75);
  /* today's budget is fixed at the start of the day: (1000 - 100 spent before today) / 21 days left */
  assert.strictEqual(s.startOfToday, 900);
  assert.strictEqual(s.todayBudget, roundTo(900 / 21));
  assert.strictEqual(s.leftToday, roundTo(roundTo(900 / 21) - 46.25));
  assert.strictEqual(s.canSpendToday, s.leftToday);
  assert.strictEqual(s.dailyAverage, 14.63);
});
function roundTo(n){ return Math.round(n * 100) / 100; }

test("today's budget: the exact reported case (remaining 2,617.98, 25 days left, 441.28 spent today)", () => {
  /* start of today = 3500 - 440.74 = 3059.26 ; remaining after today's spending = 2617.98 */
  const cycles = [cyc("a", "2026-09-27", 3500, { expectedNextSalaryDate: "2026-10-28" })];
  const entries = [exp("before", "2026-09-30", 440.74), exp("today", "2026-10-03", 441.28)];
  const s = L.cycleSummary(cycles, cycles[0], entries, "2026-10-03");
  assert.strictEqual(s.remaining, 2617.98);
  assert.strictEqual(s.daysLeft, 25);
  assert.strictEqual(s.startOfToday, 3059.26);
  assert.strictEqual(s.todayBudget, 122.37);
  assert.strictEqual(s.spentToday, 441.28);
  assert.strictEqual(s.leftToday, -318.91);
  assert.strictEqual(s.overToday, 318.91);
  assert.strictEqual(s.tomorrow, 109.08);               /* 2617.98 / (25 - 1) */
});
test("today's budget stays FIXED while you spend: spending more only lowers what is left today", () => {
  const cycles = [cyc("a", "2026-09-27", 3500, { expectedNextSalaryDate: "2026-10-28" })];
  const base = [exp("before", "2026-09-30", 440.74)];
  const at = amount => L.cycleSummary(cycles, cycles[0], amount ? base.concat([exp("t", "2026-10-03", amount)]) : base, "2026-10-03");
  const budgets = [0, 10, 100, 441.28, 900].map(a => at(a).todayBudget);
  assert.ok(budgets.every(b => b === budgets[0]), "budget must not move: " + budgets.join(","));
  assert.strictEqual(at(100).leftToday, roundTo(budgets[0] - 100));
  assert.strictEqual(at(122.37).leftToday, 0);
  assert.strictEqual(at(122.37).overToday, 0);
  assert.strictEqual(at(122.37).tomorrow, null, "not over: no 'tomorrow' line");
  assert.ok(at(122.38).overToday > 0);
});
test("today's budget with nothing spent today: the whole share is left, and no 'tomorrow' figure", () => {
  const cycles = [cyc("a", "2026-09-27", 3000, { expectedNextSalaryDate: "2026-10-27" })];
  const s = L.cycleSummary(cycles, cycles[0], [exp("e", "2026-09-30", 300)], "2026-10-03");
  assert.strictEqual(s.daysLeft, 24);
  assert.strictEqual(s.startOfToday, 2700);
  assert.strictEqual(s.todayBudget, 112.5);
  assert.strictEqual(s.spentToday, 0);
  assert.strictEqual(s.leftToday, 112.5);
  assert.strictEqual(s.overToday, 0);
  assert.strictEqual(s.tomorrow, null);
});
test("today's budget with income dated today: it adds to today's budget, not to the start-of-day pool", () => {
  const cycles = [cyc("a", "2026-09-27", 3000, { expectedNextSalaryDate: "2026-10-27" })];
  const entries = [exp("e", "2026-09-30", 300), { id: "i", type: "income", amount: 50, date: "2026-10-03" }, exp("t", "2026-10-03", 60)];
  const s = L.cycleSummary(cycles, cycles[0], entries, "2026-10-03");
  assert.strictEqual(s.startOfToday, 2700, "today's income is not in the start-of-day figure");
  assert.strictEqual(s.todayBudget, 162.5);               /* 2700 / 24 + 50 */
  assert.strictEqual(s.leftToday, 102.5);
  /* income from an earlier day IS part of the start-of-day pool */
  const s2 = L.cycleSummary(cycles, cycles[0], [{ id: "i", type: "income", amount: 240, date: "2026-10-01" }], "2026-10-03");
  assert.strictEqual(s2.startOfToday, 3240);
  assert.strictEqual(s2.todayBudget, 135);
  /* the tomorrow figure counts today's income and spending */
  const over = L.cycleSummary(cycles, cycles[0], [{ id: "i", type: "income", amount: 50, date: "2026-10-03" }, exp("t", "2026-10-03", 400)], "2026-10-03");
  assert.strictEqual(over.tomorrow, roundTo((3000 + 50 - 400) / 23));
});
test("today's budget ignores deleted entries and entries dated after today; last day has no 'tomorrow'", () => {
  const cycles = [cyc("a", "2026-09-27", 3000, { expectedNextSalaryDate: "2026-10-27" })];
  const entries = [exp("gone", "2026-09-30", 999, { deletedAt: 1 }), exp("future", "2026-10-10", 500), exp("t", "2026-10-03", 5, { deletedAt: 2 })];
  const s = L.cycleSummary(cycles, cycles[0], entries, "2026-10-03");
  assert.strictEqual(s.startOfToday, 3000);
  assert.strictEqual(s.spentToday, 0);
  assert.strictEqual(s.leftToday, 125);
  const last = L.cycleSummary([cyc("a", "2026-09-27", 100, { expectedNextSalaryDate: "2026-10-04" })], { id: "a", startDate: "2026-09-27", allowance: 100, expectedNextSalaryDate: "2026-10-04" }, [exp("t", "2026-10-03", 150)], "2026-10-03");
  assert.strictEqual(last.daysLeft, 1);
  assert.strictEqual(last.leftToday, -50);
  assert.strictEqual(last.tomorrow, null, "daysLeft is 1: no tomorrow in this cycle");
});

test("summary: days left is at least 1, even on or after the expected salary date", () => {
  const cycles = [cyc("a", "2026-05-01", 300, { expectedNextSalaryDate: "2026-05-31" })];
  for (const today of ["2026-05-30", "2026-05-31", "2026-06-05"]) {
    const s = L.cycleSummary(cycles, cycles[0], [], today);
    assert.strictEqual(s.daysLeft, 1, today);
    assert.strictEqual(s.canSpendToday, 300, today);
  }
});

test("summary: no expectedNextSalaryDate means no daysLeft / canSpendToday; bad or earlier dates are ignored", () => {
  for (const exp_ of [undefined, "", "garbage", "2026-04-01", "2026-05-01"]) {
    const cycles = [cyc("a", "2026-05-01", 300, exp_ === undefined ? {} : { expectedNextSalaryDate: exp_ })];
    const s = L.cycleSummary(cycles, cycles[0], [], "2026-05-10");
    assert.strictEqual(s.daysLeft, null, String(exp_));
    assert.strictEqual(s.canSpendToday, null, String(exp_));
  }
});

test("summary: over budget is flagged and the daily figure goes negative", () => {
  const cycles = [cyc("a", "2026-05-01", 100, { expectedNextSalaryDate: "2026-05-11" })];
  const s = L.cycleSummary(cycles, cycles[0], [exp("1", "2026-05-02", 150)], "2026-05-06");
  assert.strictEqual(s.remaining, -50);
  assert.strictEqual(s.over, true);
  assert.strictEqual(s.daysLeft, 5);
  assert.strictEqual(s.canSpendToday, -10);
  assert.strictEqual(s.progress, 1);
});

test("summary: a closed (past) cycle uses its own length, not today's date", () => {
  const cycles = [cyc("a", "2026-01-27", 500, { expectedNextSalaryDate: "2026-02-20" }), cyc("b", "2026-02-27")];
  const s = L.cycleSummary(cycles, cycles[0], [exp("1", "2026-02-01", 100)], "2026-04-01");
  assert.strictEqual(s.open, false);
  assert.strictEqual(s.totalDays, 31);
  assert.strictEqual(s.daysElapsed, 31);
  assert.strictEqual(s.daysLeft, null);
  assert.strictEqual(s.canSpendToday, null);
  assert.strictEqual(s.spentToday, 0);
});

test("summary: a cycle that starts in the future has 0 days elapsed", () => {
  const cycles = [cyc("a", "2026-06-01", 100)];
  const s = L.cycleSummary(cycles, cycles[0], [], "2026-05-20");
  assert.strictEqual(s.daysElapsed, 0);
  assert.strictEqual(s.dailyAverage, 0);
});

test("summary: an entry on the boundary day counts in the new cycle's totals only", () => {
  const cycles = [cyc("a", "2026-01-27", 1000), cyc("b", "2026-02-27", 1000)];
  const entries = [exp("1", "2026-02-26", 10), exp("2", "2026-02-27", 20)];
  assert.strictEqual(L.cycleSummary(cycles, cycles[0], entries, "2026-03-01").spent, 10);
  assert.strictEqual(L.cycleSummary(cycles, cycles[1], entries, "2026-03-01").spent, 20);
});

test("sumMoney avoids float drift", () => {
  assert.strictEqual(L.sumMoney([0.1, 0.2]), 0.3);
  assert.strictEqual(L.sumMoney(Array(10).fill(0.1)), 1);
  assert.strictEqual(L.sumMoney([46.25]), 46.25);
});

console.log("  " + tz.padEnd(22) + pass + " passed" + (fail ? ", " + fail + " FAILED" : ""));
process.exit(fail ? 1 : 0);
