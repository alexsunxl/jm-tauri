#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const configPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
const raw = fs.readFileSync(configPath, "utf8");
const json = JSON.parse(raw);
const version = String(json.version || "").trim();
console.log(`[bump-version] path=${configPath} version=${JSON.stringify(version)}`);

const match = version.match(/^(\d+)\.(\d+)\.(\d+)([-+].+)?$/);
if (!match) {
  process.exit(0);
}

const major = match[1];
const minor = match[2];
const nextPatch = Number(match[3]) + 1;
const suffix = match[4] || "";
json.version = `${major}.${minor}.${nextPatch}${suffix}`;

fs.writeFileSync(configPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
console.log(`[bump-version] next=${json.version}`);
