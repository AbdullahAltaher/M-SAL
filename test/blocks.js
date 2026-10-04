"use strict";
/* Loads the pure-logic blocks of index.html into one scope (exactly as the page has them)
   and returns every function the tests need. */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
function block(name){
  const m = new RegExp("/\\* @@" + name + "-BEGIN[\\s\\S]*?/\\* @@" + name + "-END \\*/").exec(html);
  if (!m) throw new Error("block " + name + " not found in index.html");
  return m[0];
}
const NAMES = ["KEY", "BAK", "OLD_KEYS", "SCHEMA_VERSION", "DEFAULT_ACCOUNT_ID", "DEFAULT_CATEGORIES", "AR_MONTHS",
  "sanitizeState", "sanitizeData", "sanitizeExp", "seedData", "loadFrom", "defaultExp", "defaultCategories", "isObj",
  "parseDate", "isValidDate", "dayNumber", "addDays", "daysBetween", "localDateStr", "todayStr", "roundMoney", "sumMoney",
  "sortCycles", "cycleForDate", "cycleBounds", "bucketEntries", "validateCycleDate", "addCycle", "setCycleDate",
  "prefillNewCycle", "cycleSummary",
  "AED", "formatMoney", "moneyText", "toLatinDigits", "parseEntryAmount", "weekdayIndex", "shortArabicDate",
  "fullArabicDate", "dayLabel", "NO_CYCLE_KEY", "newEntry", "entryAccountId", "accountEntries", "liveEntries",
  "deletedEntries", "searchKey", "filterEntries", "groupByDay", "categoryTotals", "lastDays", "cycleTrend",
  "categoryChanges", "canSaveEntry", "suggestNames", "DEFAULT_SUGGESTIONS", "chartNum", "smoothPath", "buildReceiptModel", "movedEntryCount", "replaceKeepingExp", "countState", "contentScore", "mergeStates", "parseImport",
  "META_KEY", "TAB_KEY", "SNAP_MAX", "EXPORT_REMIND_DAYS", "isQuotaError", "scoreOfRaw", "overwriteRisk", "writeMain",
  "mirrorWrite", "mirrorRead", "takeSnapshot", "listSnapshots", "planRecovery", "readMeta", "writeMeta",
  "exportReminder", "exportFileName"];
const code = '"use strict";\n' + block("DATA-MODEL") + "\n" + block("EXP-LOGIC") + "\n" + block("PERSIST") +
  "\nreturn {" + NAMES.join(",") + "};";
module.exports = new Function(code)();
module.exports.html = html;

/* tiny runner shared by the suites */
module.exports.runner = function(title){
  let pass = 0, fail = 0;
  return {
    test(name, fn){
      try { fn(); pass++; console.log("  ok   " + name); }
      catch (e) { fail++; console.log("  FAIL " + name + "\n       " + String(e && e.message).split("\n").slice(0, 14).join("\n       ")); }
    },
    async atest(name, fn){
      try { await fn(); pass++; console.log("  ok   " + name); }
      catch (e) { fail++; console.log("  FAIL " + name + "\n       " + String(e && e.message).split("\n").slice(0, 14).join("\n       ")); }
    },
    done(){ console.log("\n" + title + ": " + pass + " passed" + (fail ? ", " + fail + " FAILED" : "")); process.exit(fail ? 1 : 0); }
  };
};
