#!/usr/bin/env python3
"""Writes THIRD_PARTY_NOTICES.md: the open-source components shipped in the
server binary (Rust crates) and the web app (npm packages), with their
licenses. Run from the repository root after `npm ci` in web/:
    python3 scripts/third-party-notices.py
"""
import json, os, subprocess, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

meta = json.loads(subprocess.run(
    ["cargo", "metadata", "--format-version", "1", "--locked", "--filter-platform", "x86_64-unknown-linux-gnu"],
    cwd=os.path.join(root, "server"), capture_output=True, text=True, check=True).stdout)
# only crates linked into the release binary (normal dependencies)
nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
pkgs = {p["id"]: p for p in meta["packages"]}
rootid = meta["resolve"]["root"]
seen, stack = set(), [rootid]
while stack:
    i = stack.pop()
    for d in nodes[i]["deps"]:
        if any(k["kind"] is None for k in d["dep_kinds"]) and d["pkg"] not in seen:
            seen.add(d["pkg"]); stack.append(d["pkg"])
crates = sorted((pkgs[i] for i in seen), key=lambda p: (p["name"], p["version"]))

web = os.path.join(root, "web")
lock = json.load(open(os.path.join(web, "package-lock.json")))
npm = []
for path, info in sorted(lock.get("packages", {}).items()):
    if not path or info.get("dev") or info.get("devOptional"):
        continue
    name = path.split("node_modules/")[-1]
    lic = info.get("license")
    if not lic:
        pj = os.path.join(web, path, "package.json")
        if os.path.exists(pj):
            lic = json.load(open(pj)).get("license")
    npm.append((name, info.get("version", ""), lic or "see package"))

out = ["# Third-party notices", "",
       "This product includes the open-source components below. Each is used under its own license;",
       "the license texts are in each component's source distribution (crates.io / npmjs.com).", "",
       "## Server (Rust crates)", "", "| Crate | Version | License |", "| --- | --- | --- |"]
out += [f"| {p['name']} | {p['version']} | {p.get('license') or 'see crate'} |" for p in crates]
out += ["", "## Web app (npm packages bundled into the build)", "", "| Package | Version | License |", "| --- | --- | --- |"]
out += [f"| {n} | {v} | {l} |" for n, v, l in npm]
open(os.path.join(root, "THIRD_PARTY_NOTICES.md"), "w").write("\n".join(out) + "\n")
print(f"{len(crates)} crates, {len(npm)} npm packages")
