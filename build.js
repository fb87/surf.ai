#!/usr/bin/env node
// Bundles the app into a single self-contained, minified HTML file.
// Run inside `nix-shell` (see shell.nix) for `esbuild` on PATH: `node build.js`.
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const OUT_FILE = path.join(DIST, "surf.ai.html");

function esbuild(args, input) {
  return execFileSync("esbuild", args, { input, maxBuffer: 100 * 1024 * 1024 }).toString();
}

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function main() {
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Bundle + minify the ES module graph into a single IIFE script.
  const appBundle = esbuild([path.join(ROOT, "js/app.js"), "--bundle", "--minify", "--format=iife"]);

  // 2. Concatenate CSS in cascade order, inline the variable-font files as
  //    base64 data URIs (no separate font files in a single-file build), then minify.
  const cssOrder = ["theme.css", "base.css", "components.css", "layout.css", "markdown.css"];
  let combinedCss = cssOrder.map((f) => readFile(path.join("css", f))).join("\n");

  const fontNormal = fs.readFileSync(path.join(ROOT, "css/fonts/alegreya-normal.woff2")).toString("base64");
  const fontItalic = fs.readFileSync(path.join(ROOT, "css/fonts/alegreya-italic.woff2")).toString("base64");
  combinedCss = combinedCss
    .split('url("fonts/alegreya-normal.woff2")').join(`url(data:font/woff2;base64,${fontNormal})`)
    .split('url("fonts/alegreya-italic.woff2")').join(`url(data:font/woff2;base64,${fontItalic})`);

  const minifiedCss = esbuild(["--loader=css", "--minify"], combinedCss);

  // 3. Vendor UMD scripts are already minified upstream — inline verbatim, in
  //    the same load order as index.html (purify before marked before mermaid).
  const vendorOrder = ["purify.min.js", "marked.min.js", "mermaid.min.js"];
  const vendorScripts = vendorOrder.map((f) => readFile(path.join("js/vendor", f)));

  // 4. Inject into index.html's own markup (source of truth for structure),
  //    replacing the external <link>/<script src> tags with inline equivalents.
  //
  //    Swap in unique placeholder tokens FIRST, while `html` is still just the
  //    small original index.html — then substitute those tokens for the real
  //    (large, unpredictable) content via split/join as a separate final pass.
  //    This avoids two real failure modes of chaining String#replace() calls
  //    directly against the growing output: (a) once a vendor blob the size of
  //    mermaid.min.js is inlined, a *later* .replace() searching for another
  //    tag's literal text can match a coincidental occurrence of that same
  //    substring inside the already-inserted blob instead of the real tag
  //    further down the document, and (b) .replace()'s string-replacement form
  //    treats "$&", "$1", etc. in the *replacement* argument specially, which
  //    minified vendor source triggers in practice.
  let html = readFile("index.html");

  html = html.replace('<link rel="stylesheet" href="css/theme.css" />', "__SURFAI_CSS__");
  for (const f of ["base.css", "components.css", "layout.css", "markdown.css"]) {
    html = html.replace(`<link rel="stylesheet" href="css/${f}" />\n`, "");
  }
  html = html.replace('<script src="js/vendor/purify.min.js"></script>', "__SURFAI_PURIFY__");
  html = html.replace('<script src="js/vendor/marked.min.js"></script>', "__SURFAI_MARKED__");
  html = html.replace('<script src="js/vendor/mermaid.min.js"></script>', "__SURFAI_MERMAID__");
  html = html.replace('<script type="module" src="js/app.js"></script>', "__SURFAI_APPJS__");

  html = html.split("__SURFAI_CSS__").join(`<style>${minifiedCss}</style>`);
  html = html.split("__SURFAI_PURIFY__").join(`<script>${vendorScripts[0]}</script>`);
  html = html.split("__SURFAI_MARKED__").join(`<script>${vendorScripts[1]}</script>`);
  html = html.split("__SURFAI_MERMAID__").join(`<script>${vendorScripts[2]}</script>`);
  html = html.split("__SURFAI_APPJS__").join(`<script>${appBundle}</script>`);

  fs.writeFileSync(OUT_FILE, html);
  const sizeMb = (Buffer.byteLength(html) / (1024 * 1024)).toFixed(2);
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${sizeMb} MB)`);
}

main();
