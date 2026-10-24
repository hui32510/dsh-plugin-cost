#!/usr/bin/env node
/**
 * Link this repository into a DSH desktop profile.
 *
 * The profile lives at `<harness home>/profiles/<profile>` (default `desktop`)
 * and resolves plugins from its `node_modules`. DSH reads the profile manifest
 * at startup, so after this script finishes the app must be restarted.
 *
 * Usage:
 *   node install.mjs [--profile desktop] [--copy] [--home <harness home>]
 *
 *   --profile <name>  profile directory name (default: desktop)
 *   --home <dir>      harness home (default: ~/.dsh; mainly for tests)
 *   --copy            copy lib/ into the profile instead of creating a junction
 *                     (needed when node_modules/dsh-cost is a real directory
 *                     that cannot be replaced, e.g. pnpm materialized it)
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const profile = arg("profile", "desktop");
const copy = argv.includes("--copy");
const harnessHome = arg("home", join(homedir(), ".dsh"));

const profileDir = join(harnessHome, "profiles", profile);
const manifest = join(profileDir, "package.json");
if (!existsSync(manifest)) {
  console.error(`找不到 profile: ${manifest}`);
  console.error("先安装并启动一次 DSH，或用 --profile <名字> 指定。");
  process.exit(1);
}

// ---- 1. profile manifest: link dependency + bundle row ---------------------
const pkg = JSON.parse(readFileSync(manifest, "utf8"));
pkg.dependencies = { ...(pkg.dependencies ?? {}) };
pkg.dependencies["dsh-cost"] = `link:${repo.replace(/\\/g, "/")}`;
pkg.dsh = pkg.dsh ?? {};
pkg.dsh.profile = pkg.dsh.profile ?? {};
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
if (!bundles.includes("dsh-cost")) bundles.push("dsh-cost");
pkg.dsh.profile.bundles = bundles;
writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`profile 已更新: ${manifest}`);

// ---- 2. node_modules/dsh-cost: junction (default) or a copied tree ---------
const modules = join(profileDir, "node_modules");
const link = join(modules, "dsh-cost");
const targetEntry = join(repo, "lib", "index.js");
mkdirSync(modules, { recursive: true });

/** Whether `link` already resolves to this repository (junction/symlink or a copy of the same file). */
const sameFile = (left, right) => {
  try {
    const a = statSync(left);
    const b = statSync(right);
    return a.ino === b.ino && a.dev === b.dev;
  } catch {
    return false;
  }
};

if (sameFile(join(link, "lib", "index.js"), targetEntry)) {
  console.log(`node_modules/dsh-cost -> ${repo}（已经是链接，无需改动）`);
} else if (copy) {
  mkdirSync(link, { recursive: true });
  for (const file of ["lib/index.js", "lib/client.js", "cordis.patch.yml", "package.json"]) {
    const parts = file.split("/");
    const destination = join(link, ...parts);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repo, ...parts), destination);
  }
  console.log(`文件已复制到 ${link}（副本模式）`);
} else {
  if (existsSync(link)) {
    try {
      unlinkSync(link);
    } catch {
      try {
        rmdirSync(link);
      } catch {
        console.error(`\n${link} 已存在且不是链接（是实体目录）。`);
        console.error("  想保留为 junction：先删掉它再重跑（或运行 pnpm install 重建）；");
        console.error("  想直接覆盖文件：加 --copy。");
        process.exit(1);
      }
    }
  }
  symlinkSync(repo, link, process.platform === "win32" ? "junction" : "dir");
  console.log(`node_modules/dsh-cost -> ${repo}`);
}

console.log("\n完成。重启 DSH（托盘右键 →「重启 DeepSeek Harness」）后生效。");
