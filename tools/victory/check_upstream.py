#!/usr/bin/env python3
"""Report textual upstream merge compatibility without changing the working tree."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request


def release_tag(value):
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", value):
        raise ValueError("Expected an upstream stable release tag")
    return value


def latest_release():
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "victory-upstream-compatibility"}
    if os.environ.get("GH_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GH_TOKEN"]
    req = urllib.request.Request("https://api.github.com/repos/invoiceninja/invoiceninja/releases/latest", headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return release_tag(json.load(response)["tag_name"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream-tag", type=release_tag, help="Use an explicit stable release instead of querying latest")
    parser.add_argument("--fetch", action="store_true", help="Fetch shallow tag snapshots (for isolated CI checkouts)")
    args = parser.parse_args()
    base = release_tag("v" + Path("VERSION.txt").read_text().strip())
    upstream = args.upstream_tag or latest_release()
    if args.fetch:
        subprocess.run(["git", "fetch", "--no-tags", "--depth=1", "https://github.com/invoiceninja/invoiceninja.git",
                        *[f"refs/tags/{tag}:refs/tags/{tag}" for tag in sorted({base, upstream})]], check=True, capture_output=True, timeout=180)
    # Explicit base trees allow an isolated shallow CI checkout. No checkout,
    # branch update, index write, deployment, or application migration occurs.
    result = subprocess.run(["git", "merge-tree", "--write-tree", "--name-only", "--no-messages",
                             f"--merge-base={base}", "HEAD", upstream], capture_output=True, text=True, timeout=120)
    if result.returncode not in (0, 1):
        raise RuntimeError("Could not complete the upstream merge check")
    paths = sorted(set(line for line in result.stdout.splitlines()[1:] if line.strip()))
    major_change = base.split(".")[0] != upstream.split(".")[0]
    report = {"base_tag": base, "upstream_tag": upstream, "text_merge_clean": result.returncode == 0,
              "major_version_change": major_change, "conflicted_paths": paths}
    print(json.dumps(report))
    summary = ["## Upstream compatibility", "", f"Fork base: `{base}` · Latest checked: `{upstream}`", "",
               "Textual merge is clean." if result.returncode == 0 else f"Manual merge required: {len(paths)} conflicted paths."]
    summary += [f"- `{path}`" for path in paths]
    if major_change:
        summary += ["", "Major version change: review the supported migration path before upgrading."]
    summary += ["", "Run the fork's server/UI tests against the resolved merge and validate migrations in staging before any release.",
                "This report is informational; it does not merge or deploy upstream changes.", ""]
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
            handle.write("\n".join(summary))
    if os.environ.get("GITHUB_ACTIONS") == "true" and (result.returncode == 1 or major_change):
        print("::warning title=Upstream compatibility::An upstream update needs manual review. See the job summary.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Keep HTTP headers, tokens and response bodies out of CI logs.
        print(f"Upstream compatibility check failed: {type(exc).__name__}")
        raise SystemExit(1) from None
