"use strict";
/* Data-safety layer: verified writes, quota errors, empty-overwrite guard, IndexedDB mirror,
   recovery from a corrupted main store, rolling snapshots, export reminder.
   Run: node test/persistence.test.js   (synthetic data; fake storage and fake IndexedDB) */
const assert = require("assert");
const L = require("./blocks");
const { atest, test, done } = L.runner("persistence");
const clone = v => JSON.parse(JSON.stringify(v));
const DAY = 86400000;

/* ---------- fakes ---------- */
function makeStore(init, hooks){
  const map = new Map(Object.entries(init || {}));
  hooks = hooks || {};
  const s = {
    writes: 0,
    getItem: k => { if (hooks.getItem) { const r = hooks.getItem(k, map); if (r !== undefined) return r === "__null__" ? null : r; } return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { s.writes++; if (hooks.setItem) hooks.setItem(k, v, map); map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    map
  };
  return s;
}
function quotaError(){ const e = new Error("quota"); e.name = "QuotaExceededError"; e.code = 22; return e; }
function makeIdb(opts){
  opts = opts || {};
  const stores = { mirror: new Map(), snapshots: new Map() };
  return {
    stores,
    async get(s, k){ if (opts.broken) throw new Error("idb down"); return stores[s].get(k); },
    async put(s, k, v){ if (opts.broken) throw new Error("idb down"); stores[s].set(k, clone(v)); },
    async del(s, k){ if (opts.broken) throw new Error("idb down"); stores[s].delete(k); },
    async all(s){ if (opts.broken) throw new Error("idb down"); return [...stores[s].values()].map(clone); }
  };
}

/* ---------- synthetic data ---------- */
function makeState(n){
  const st = L.sanitizeState({ currentId: "p1", profiles: [
    { id: "p1", name: "عبدالله", data: { monthLabel: "أكتوبر 2026", salaryLabel: "الراتب", salary: "15000",
        blocks: [{ id: "b1", title: "التزامات", rows: [{ id: "r1", name: "إيجار", amount: "~4500", done: true }, { id: "r2", name: "كهرباء", amount: "380.5", done: false }] }] } },
    { id: "p2", name: "أم خالد", data: { blocks: [{ id: "b2", title: "البيت", rows: [{ id: "r3", name: "بقالة", amount: "900", done: false }] }] } } ] });
  const e = st.profiles[0].data.exp;
  e.accounts[0].cycles = [{ id: "c1", startDate: "2026-09-02", allowance: 3000 }];
  for (let i = 0; i < (n == null ? 5 : n); i++) e.entries.push({ id: "e" + i, type: "expense", amount: 10 + i, name: "عنصر " + i, categoryId: "cat_food", date: "2026-09-0" + (3 + (i % 6)), accountId: "acc_main", createdAt: 1000 + i });
  return st;
}
const empty = () => L.loadFrom(makeStore({})).state;

(async () => {
  /* ================= verified writes ================= */
  await atest("a normal save writes main and .bak and verifies by reading back", async () => {
    const store = makeStore({}); const st = makeState();
    const r = L.writeMain(store, st);
    assert.ok(r.ok && r.bakOk);
    assert.strictEqual(store.getItem(L.KEY), JSON.stringify(st));
    assert.strictEqual(store.getItem(L.BAK), JSON.stringify(st));
    assert.deepStrictEqual(JSON.parse(store.getItem(L.KEY)), st);
  });
  await atest("quota error on the main write: reported as 'quota', previous data untouched, nothing pruned", async () => {
    const old = makeState(2), store = makeStore({ [L.KEY]: JSON.stringify(old), [L.BAK]: JSON.stringify(old), "mizaniya.other": "x" },
      { setItem: k => { if (k === L.KEY) throw quotaError(); } });
    const r = L.writeMain(store, makeState(9));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.kind, "quota");
    assert.strictEqual(store.getItem(L.KEY), JSON.stringify(old), "old main value intact");
    assert.strictEqual(store.getItem(L.BAK), JSON.stringify(old), ".bak untouched");
    assert.strictEqual(store.getItem("mizaniya.other"), "x", "no other key was removed");
  });
  await atest("quota error is recognised across browsers", async () => {
    for (const e of [{ name: "QuotaExceededError" }, { name: "NS_ERROR_DOM_QUOTA_REACHED" }, { code: 22 }, { code: 1014 }]) assert.ok(L.isQuotaError(e));
    assert.ok(!L.isQuotaError(new Error("x")) && !L.isQuotaError(null));
  });
  await atest("silent write failure (value not persisted) is caught by the read-back", async () => {
    const store = makeStore({}, { getItem: k => (k === L.KEY ? "__null__" : undefined) });   // setItem 'succeeds' but nothing sticks
    const r = L.writeMain(store, makeState());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.kind, "verify");
  });
  await atest("a stale/corrupted read-back is caught", async () => {
    const store = makeStore({}, { getItem: k => (k === L.KEY ? "{\"truncated" : undefined) });
    assert.strictEqual(L.writeMain(store, makeState()).kind, "verify");
  });
  await atest("a failing .bak write does not fail the save, but is reported", async () => {
    const store = makeStore({}, { setItem: k => { if (k === L.BAK) throw quotaError(); } });
    const r = L.writeMain(store, makeState());
    assert.ok(r.ok);
    assert.strictEqual(r.bakOk, false);
  });
  await atest("a storage that throws on write (blocked) reports 'write'", async () => {
    const store = makeStore({}, { setItem: () => { throw new Error("SecurityError"); } });
    assert.strictEqual(L.writeMain(store, makeState()).kind, "write");
  });
  await atest("an unserialisable state is reported, nothing written", async () => {
    const store = makeStore({}); const st = makeState(); st.self = st;
    assert.strictEqual(L.writeMain(store, st).kind, "stringify");
    assert.strictEqual(store.writes, 0);
  });

  /* ================= never overwrite data with an empty state ================= */
  await atest("empty/default state over stored data is refused", async () => {
    const store = makeStore({ [L.KEY]: JSON.stringify(makeState()) });
    assert.strictEqual(L.overwriteRisk(store, empty()), "empty-over-data");
  });
  await atest("empty/default state over an UNREADABLE stored value is refused (it might still be recoverable)", async () => {
    const store = makeStore({ [L.KEY]: "{\"profiles\":[{\"id\":" });
    assert.strictEqual(L.overwriteRisk(store, empty()), "empty-over-corrupt");
  });
  await atest("empty state over nothing, or over another empty state, is fine; real data over anything is fine", async () => {
    assert.strictEqual(L.overwriteRisk(makeStore({}), empty()), "");
    assert.strictEqual(L.overwriteRisk(makeStore({ [L.KEY]: JSON.stringify(empty()) }), empty()), "");
    assert.strictEqual(L.overwriteRisk(makeStore({ [L.KEY]: JSON.stringify(makeState()) }), makeState(1)), "");
    assert.strictEqual(L.overwriteRisk(makeStore({ [L.KEY]: "{{{" }), makeState()), "", "good data may replace a corrupt value");
  });
  await atest("the v1 data shape counts as data too", async () => {
    const v1 = { monthLabel: "x", salaryLabel: "ر", salary: "100", blocks: [] };
    assert.ok(L.scoreOfRaw(JSON.stringify(v1)) > 0);
  });

  /* ================= IndexedDB mirror ================= */
  await atest("mirror write then read returns the same JSON", async () => {
    const idb = makeIdb(); const json = JSON.stringify(makeState());
    assert.strictEqual(await L.mirrorWrite(idb, json, 5), true);
    const rec = await L.mirrorRead(idb);
    assert.strictEqual(rec.json, json);
    assert.strictEqual(rec.savedAt, 5);
  });
  await atest("a broken IndexedDB never throws: write returns false, read returns null", async () => {
    const idb = makeIdb({ broken: true });
    assert.strictEqual(await L.mirrorWrite(idb, "{}", 1), false);
    assert.strictEqual(await L.mirrorRead(idb), null);
    assert.deepStrictEqual(await L.listSnapshots(idb), []);
    assert.ok((await L.takeSnapshot(idb, JSON.stringify(makeState()), "x", 1, "2026-10-02", "forced")).failed);
  });

  /* ================= recovery from a corrupted / missing / empty main store ================= */
  async function bootWith(storeInit, mirrorState){
    const store = makeStore(storeInit), idb = makeIdb();
    if (mirrorState) await L.mirrorWrite(idb, JSON.stringify(mirrorState), 1);
    const info = L.loadFrom(store);
    const plan = L.planRecovery(info, await L.mirrorRead(idb));
    const state = plan.restore ? L.sanitizeState(JSON.parse((await L.mirrorRead(idb)).json)) : info.state;
    return { store, idb, info, plan, state };
  }
  await atest("corrupted main store, no .bak: restored from the mirror, identical to what was saved", async () => {
    const good = L.sanitizeState(makeState());
    const r = await bootWith({ [L.KEY]: JSON.stringify(good).slice(0, 200) }, good);
    assert.strictEqual(r.info.source, "empty");
    assert.deepStrictEqual(r.plan, { restore: true, why: "main-corrupt" });
    assert.deepStrictEqual(r.state, good);
  });
  await atest("missing main store (storage wiped): restored from the mirror", async () => {
    const good = L.sanitizeState(makeState());
    const r = await bootWith({}, good);
    assert.deepStrictEqual(r.plan, { restore: true, why: "main-missing" });
    assert.deepStrictEqual(r.state, good);
  });
  await atest("empty main store while the mirror has data: restored", async () => {
    const good = L.sanitizeState(makeState());
    const r = await bootWith({ [L.KEY]: JSON.stringify(empty()) }, good);
    assert.deepStrictEqual(r.plan, { restore: true, why: "main-empty" });
    assert.deepStrictEqual(r.state, good);
  });
  await atest("wrong-shape main store ('[]', '{}', 'null') while the mirror has data: restored", async () => {
    const good = L.sanitizeState(makeState());
    for (const bad of ["[]", "{}", "null", "\"x\"", "{\"profiles\":[]}"]) {
      const r = await bootWith({ [L.KEY]: bad }, good);
      assert.ok(r.plan.restore, bad);
      assert.deepStrictEqual(r.state, good, bad);
    }
  });
  await atest("only old v1 data present but the mirror has v2 data: the mirror wins", async () => {
    const good = L.sanitizeState(makeState());
    const r = await bootWith({ [L.OLD_KEYS[0]]: JSON.stringify({ blocks: [], salary: "1" }) }, good);
    assert.ok(r.plan.restore);
  });
  await atest("healthy main store is never replaced by the mirror", async () => {
    const mainState = L.sanitizeState(makeState(8)), older = L.sanitizeState(makeState(2));
    const r = await bootWith({ [L.KEY]: JSON.stringify(mainState) }, older);
    assert.deepStrictEqual(r.plan, { restore: false, why: "main-ok" });
    assert.deepStrictEqual(r.state, mainState);
  });
  await atest("main corrupt but .bak good: the verified .bak is used (and reported)", async () => {
    const good = L.sanitizeState(makeState());
    const r = await bootWith({ [L.KEY]: "{broken", [L.BAK]: JSON.stringify(good) }, good);
    assert.strictEqual(r.info.source, "bak");
    assert.deepStrictEqual(r.plan, { restore: false, why: "bak-ok" });
    assert.deepStrictEqual(r.state, good);
    assert.strictEqual(r.info.unusable[0].reason, "corrupt");
  });
  await atest("no mirror, empty mirror, corrupt mirror: nothing is restored and nothing throws", async () => {
    assert.strictEqual(L.planRecovery({ source: "empty", unusable: [], state: empty() }, null).restore, false);
    const emptyRec = { savedAt: 1, json: JSON.stringify(empty()) };
    assert.strictEqual(L.planRecovery({ source: "empty", unusable: [], state: empty() }, emptyRec).why, "mirror-empty");
    assert.strictEqual(L.planRecovery({ source: "empty", unusable: [], state: empty() }, { savedAt: 1, json: "{{" }).why, "mirror-corrupt");
  });
  await atest("a restore followed by a normal save leaves the mirror, main and .bak all identical", async () => {
    const good = L.sanitizeState(makeState());
    const r = await bootWith({ [L.KEY]: "###" }, good);
    const w = L.writeMain(r.store, r.state);
    assert.ok(w.ok);
    await L.mirrorWrite(r.idb, w.json, 2);
    assert.strictEqual(r.store.getItem(L.KEY), (await L.mirrorRead(r.idb)).json);
    assert.strictEqual(r.store.getItem(L.BAK), r.store.getItem(L.KEY));
    assert.strictEqual(L.overwriteRisk(r.store, empty()), "empty-over-data", "and the guard now protects it");
  });

  /* ================= rolling snapshots ================= */
  await atest("snapshots: at most one automatic snapshot per day", async () => {
    const idb = makeIdb(), json = JSON.stringify(makeState(1)), json2 = JSON.stringify(makeState(2));
    assert.ok((await L.takeSnapshot(idb, json, "daily", 1000, "2026-10-02", "auto")).saved);
    assert.strictEqual((await L.takeSnapshot(idb, json2, "daily", 2000, "2026-10-02", "auto")).skipped, "daily");
    assert.ok((await L.takeSnapshot(idb, json2, "daily", 3000, "2026-10-03", "auto")).saved);
    assert.strictEqual((await L.listSnapshots(idb)).length, 2);
  });
  await atest("snapshots: forced ones (migration, import, bulk delete) are always taken, even twice in a day", async () => {
    const idb = makeIdb();
    for (let i = 1; i <= 3; i++) assert.ok((await L.takeSnapshot(idb, JSON.stringify(makeState(i)), "import", i * 1000, "2026-10-02", "forced")).saved);
    assert.strictEqual((await L.listSnapshots(idb)).length, 3);
  });
  await atest("snapshots: only the last 5 are kept, newest first", async () => {
    const idb = makeIdb();
    for (let i = 1; i <= 9; i++) await L.takeSnapshot(idb, JSON.stringify(makeState(i)), "bulk-delete", i * 1000, "2026-10-0" + i, "forced");
    const list = await L.listSnapshots(idb);
    assert.strictEqual(list.length, L.SNAP_MAX);
    assert.deepStrictEqual(list.map(s => s.at), [9000, 8000, 7000, 6000, 5000]);
  });
  await atest("snapshots: identical-to-newest and empty states are skipped (they would only evict good ones)", async () => {
    const idb = makeIdb(), json = JSON.stringify(makeState());
    await L.takeSnapshot(idb, json, "a", 1, "2026-10-01", "forced");
    assert.strictEqual((await L.takeSnapshot(idb, json, "b", 2, "2026-10-01", "forced")).skipped, "duplicate");
    assert.strictEqual((await L.takeSnapshot(idb, JSON.stringify(empty()), "c", 3, "2026-10-01", "forced")).skipped, "empty");
    assert.strictEqual((await L.listSnapshots(idb)).length, 1);
  });
  await atest("snapshots: the raw pre-migration text and a corrupt raw value are both kept as-is", async () => {
    const idb = makeIdb();
    const raw = JSON.stringify({ currentId: "p1", profiles: makeState().profiles.map(p => { const c = clone(p); delete c.data.exp; return c; }) });
    assert.ok((await L.takeSnapshot(idb, raw, "migration", 1, "2026-10-02", "forced")).saved);
    const corrupt = "{\"profiles\":[{\"id\":\"p1\",\"name\":\"عبد";
    assert.ok((await L.takeSnapshot(idb, corrupt, "corrupt-main", 2, "2026-10-02", "forced")).saved);
    const list = await L.listSnapshots(idb);
    assert.strictEqual(list[0].json, corrupt); assert.strictEqual(list[0].corrupt, true);
    assert.strictEqual(list[1].json, raw);
  });
  await atest("a snapshot can restore the exact state it captured", async () => {
    const idb = makeIdb(), st = L.sanitizeState(makeState(7));
    await L.takeSnapshot(idb, JSON.stringify(st), "bulk-delete", 1, "2026-10-02", "forced");
    const [snap] = await L.listSnapshots(idb);
    assert.deepStrictEqual(L.sanitizeState(JSON.parse(snap.json)), st);
  });

  /* ================= export reminder, file name, meta ================= */
  test("export reminder: none without data; due after 14 days from last export, or from first run if never exported", () => {
    const now = 100 * DAY;
    assert.strictEqual(L.exportReminder({}, now, false).show, false);
    assert.strictEqual(L.exportReminder({ firstSeen: now - 13 * DAY }, now, true).show, false);
    assert.strictEqual(L.exportReminder({ firstSeen: now - 14 * DAY }, now, true).show, true);
    assert.strictEqual(L.exportReminder({ firstSeen: now - 40 * DAY, lastExport: now - 2 * DAY }, now, true).show, false);
    assert.strictEqual(L.exportReminder({ lastExport: now - 15 * DAY }, now, true).show, true);
    assert.strictEqual(L.exportReminder({ lastExport: now - 15 * DAY }, now, true).never, false);
    assert.strictEqual(L.exportReminder({}, now, true).show, false, "brand-new install is not nagged");
  });
  test("export file name carries the LOCAL date and ends in .json", () => {
    assert.strictEqual(L.exportFileName(new Date(2026, 9, 2, 0, 30)), "ميزانية-2026-10-02.json");
    assert.strictEqual(L.exportFileName(new Date(2026, 0, 5, 23, 59)), "ميزانية-2026-01-05.json");
  });
  test("meta key: read/write merge, survives garbage, quota errors return false", () => {
    const store = makeStore({});
    assert.deepStrictEqual(L.readMeta(store), {});
    assert.ok(L.writeMeta(store, { firstSeen: 5 }));
    assert.ok(L.writeMeta(store, { lastExport: 9 }));
    assert.deepStrictEqual(L.readMeta(store), { firstSeen: 5, lastExport: 9 });
    store.map.set(L.META_KEY, "garbage");
    assert.deepStrictEqual(L.readMeta(store), {});
    assert.strictEqual(L.writeMeta(makeStore({}, { setItem: () => { throw quotaError(); } }), { a: 1 }), false);
  });
  test("separate small storage keys, existing keys unchanged", () => {
    assert.strictEqual(L.TAB_KEY, "mizaniya.ui.tab");
    assert.strictEqual(L.META_KEY, "mizaniya.v2.meta");
    assert.strictEqual(L.KEY, "mizaniya.v2");
    assert.strictEqual(L.BAK, "mizaniya.v2.bak");
  });

  done();
})();
