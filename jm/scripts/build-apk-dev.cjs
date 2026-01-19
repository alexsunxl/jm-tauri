#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const configPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
const raw = fs.readFileSync(configPath, "utf8");
const json = JSON.parse(raw);
const rawVersion = String(json.version || "").trim();
const match = rawVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);

if (!match) {
  console.error(`[build-apk-dev] invalid version in ${configPath}: ${rawVersion}`);
  process.exit(1);
}

const baseVersion = `${match[1]}.${match[2]}.${match[3]}`;
const now = new Date();
const pad2 = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(
  now.getHours(),
)}${pad2(now.getMinutes())}`;

let gitHash = "";
try {
  const res = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (res.status === 0) {
    gitHash = String(res.stdout || "").trim();
  }
} catch {
  // ignore git errors for non-repo usage
}

const versionName = `${baseVersion}-${stamp}${gitHash ? `.g${gitHash}` : ""}`;
const versionCode = Math.floor(Date.now() / 1000);

console.log(`[build-apk-dev] versionName=${versionName} versionCode=${versionCode}`);

const configOverride = {
  version: versionName,
  bundle: {
    android: {
      versionCode,
    },
  },
};

const extraArgs = process.argv.slice(2);
const result = spawnSync(
  "cargo",
  ["tauri", "android", "build", "--config", JSON.stringify(configOverride), ...extraArgs],
  { stdio: "inherit", cwd: repoRoot },
);

process.exit(result.status ?? 1);
