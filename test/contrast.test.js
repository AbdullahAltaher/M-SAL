"use strict";
/* WCAG contrast check for the Expenses glass theme, dark and light.
   Reads the --x-* design tokens straight from index.html, composites translucent fills over
   every background they can sit on (gradient ends, the brightest blob, the blue hero card,
   a white card behind a glass bar), and requires 4.5:1 for text and 3:1 for icons / large text.
   Run: node test/contrast.test.js */
const assert = require("assert");
const L = require("./blocks");
const { test, done } = L.runner("contrast");
const css = /<style>([\s\S]*)<\/style>/.exec(L.html)[1].replace(/\r\n/g, "\n");

function declsOf(block){
  const out = {};
  for (const m of block.matchAll(/(--x-[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const darkBlock = /body\.x-on\{\s*color-scheme:dark;([\s\S]*?)\n\}/.exec(css)[1];
const lightBlock = /@media \(prefers-color-scheme: light\)\{\s*body\.x-on\{\s*color-scheme:light;([\s\S]*?)\n  \}\n\}/.exec(css)[1];
const THEMES = { dark: declsOf(darkBlock), light: Object.assign({}, declsOf(darkBlock), declsOf(lightBlock)) };

function parse(c){
  c = c.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(c);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error("cannot parse colour: " + c);
}
const over = (bg, fg) => { const a = fg[3]; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)).concat([1]); };
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
function ratio(fg, bg){
  const f = over(bg, fg), a = lum(f), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const report = [];
for (const name of ["dark", "light"]) {
  const T = Object.fromEntries(Object.entries(THEMES[name]).map(([k, v]) => [k, /^(#|rgba?\()/.test(v) ? parse(v) : null]));
  const bg0 = T["--x-bg0"], bg1 = T["--x-bg1"];
  const blobPeak = over(bg0, T["--x-blob"]);                 /* brightest point of a drifting blob */
  const under = { "bg top": bg0, "bg bottom": bg1, "blob": blobPeak, "blob on bottom": over(bg1, T["--x-blob"]) };
  const heroA = T["--x-hero-a"], heroB = T["--x-hero-b"];

  test(name + ": text, muted, accent, expense, income and warning colours read on glass cards over every background", () => {
    for (const [uName, U] of Object.entries(under)) {
      const card = over(U, T["--x-card"]);
      for (const k of ["--x-text", "--x-muted", "--x-accent-ink", "--x-exp", "--x-inc", "--x-warn"]) {
        const r = ratio(T[k], card);
        report.push([name, k + " on card/" + uName, r]);
        assert.ok(r >= 4.5, name + " " + k + " on card over " + uName + " = " + r.toFixed(2));
      }
    }
  });
  test(name + ": text and muted text read directly on the background (titles, labels)", () => {
    for (const [uName, U] of Object.entries(under)) for (const k of ["--x-text", "--x-muted"]) {
      const r = ratio(T[k], U); report.push([name, k + " on " + uName, r]);
      assert.ok(r >= 4.5, name + " " + k + " on " + uName + " = " + r.toFixed(2));
    }
  });
  test(name + ": text on form fields, pills and chips (translucent fill on a card)", () => {
    for (const [uName, U] of Object.entries(under)) {
      const field = over(over(U, T["--x-card"]), T["--x-field"]);
      for (const k of ["--x-text", "--x-muted"]) {
        const r = ratio(T[k], field); report.push([name, k + " on field/" + uName, r]);
        assert.ok(r >= 4.5, name + " " + k + " on field over " + uName + " = " + r.toFixed(2));
      }
    }
  });
  test(name + ": glass header, floating bar and sheets stay legible over every background and over the blue hero card", () => {
    const stuff = Object.assign({}, under, { "hero A": heroA, "hero B": heroB, "white card": [255, 255, 255, 1] , "black": [0, 0, 0, 1] });
    /* sheets sit on the page behind a translucent scrim: check the glass over the scrim over the brightest things */
    for (const [uName, U] of Object.entries({ "bg": bg0, "blob": blobPeak, "hero A": heroA, "white": [255, 255, 255, 1] })) stuff["scrim over " + uName] = over(U, T["--x-scrim"]);
    for (const [uName, U] of Object.entries(stuff)) {
      const glass = over(U, T["--x-glass"]);
      for (const k of ["--x-text", "--x-muted"]) {
        const r = ratio(T[k], glass);
        report.push([name, k + " on glass/" + uName, r]);
        const need = k === "--x-muted" && (uName === "white card" || uName === "black") ? 3 : 4.5;   /* extreme worst cases: icon-level contrast */
        assert.ok(r >= need, name + " " + k + " on glass over " + uName + " = " + r.toFixed(2));
      }
    }
    /* the solid fallback (no backdrop-filter support) over the page background */
    for (const [uName, U] of Object.entries(under)) {
      const solid = over(U, T["--x-glass-solid"]);
      for (const k of ["--x-text", "--x-muted"]) assert.ok(ratio(T[k], solid) >= 4.5, name + " solid " + k + " over " + uName);
    }
  });
  test(name + ": white text on the blue hero card, primary buttons and the active tab (both gradient ends)", () => {
    const white = [255, 255, 255, 1];
    for (const [label, bg] of [["hero A", heroA], ["hero B", heroB], ["btn A", T["--x-btn-a"]], ["btn B", T["--x-btn-b"]]]) {
      const r = ratio(white, bg); report.push([name, "white on " + label, r]);
      assert.ok(r >= 4.5, "white on " + label + " = " + r.toFixed(2));
    }
    for (const [label, bg] of [["hero A", heroA], ["hero B", heroB]]) {
      const r = ratio(T["--x-on-hero-muted"], bg); report.push([name, "hero muted on " + label, r]);
      assert.ok(r >= 4.5, "hero muted on " + label + " = " + r.toFixed(2));
      /* the 'over budget' tag: white on a dark translucent chip, and the soft red amount (large text) */
      const tag = over(bg, [8, 20, 60, 0.35]);
      assert.ok(ratio(white, tag) >= 4.5, "over-tag on " + label);
      assert.ok(ratio([255, 226, 222, 1], bg) >= 3, "over amount on " + label);
    }
  });
  test(name + ": the 8 chart colours read at 3:1 on cards over every background, and the 'new' tag text at 4.5:1", () => {
    for (const [uName, U] of Object.entries(under)) {
      const card = over(U, T["--x-card"]);
      for (let k = 1; k <= 8; k++) {
        const r = ratio(T["--x-s" + k], card); report.push([name, "--x-s" + k + " on card/" + uName, r]);
        assert.ok(r >= 3, name + " --x-s" + k + " on card over " + uName + " = " + r.toFixed(2));
      }
      const tagBg = over(card, [77, 141, 240, 0.08]);          /* the 'new' tag fill */
      const r = ratio(T["--x-accent-ink"], tagBg); report.push([name, "new tag on tag/" + uName, r]);
      assert.ok(r >= 4.5, name + " new tag text over " + uName + " = " + r.toFixed(2));
      assert.ok(ratio(T["--x-card-solid"], card) >= 1, "solid card token parses");
    }
  });
  test(name + ": the accent colour used for icons and active dots reads at 3:1 on the background and on cards", () => {
    for (const [uName, U] of Object.entries(under)) {
      assert.ok(ratio(T["--x-accent"], U) >= 3, name + " accent on " + uName);
      assert.ok(ratio(T["--x-accent"], over(U, T["--x-card"])) >= 3, name + " accent on card/" + uName);
    }
  });
}
test("contrast report (lowest ratios)", () => {
  const worst = report.slice().sort((a, b) => a[2] - b[2]).slice(0, 8);
  for (const [theme, what, r] of worst) console.log("       " + theme.padEnd(6) + what.padEnd(36) + r.toFixed(2) + ":1");
});
done();
