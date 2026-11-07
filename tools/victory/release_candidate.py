"""Bind a release to the exact repository tree checked in a deployment PR."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def record(pr, *, repository, merge_sha, tree_sha):
    if pr["draft"] or pr["base"]["ref"] != "victory/team-app":
        raise ValueError("Only ready production PRs are deployment candidates")
    if pr["head"]["repo"]["full_name"] != repository:
        raise ValueError("Deployment candidate must belong to this repository")
    if "deployment" not in [label["name"] for label in pr["labels"]]:
        raise ValueError("Deployment label is required")
    return {
        "schema": 1,
        "repository": repository,
        "pr_number": pr["number"],
        "head_sha": pr["head"]["sha"],
        "merge_sha": merge_sha,
        "tree_sha": tree_sha,
    }


def validate(candidate, *, repository, pr_number, head_sha, tree_sha):
    expected = {
        "schema": 1,
        "repository": repository,
        "pr_number": pr_number,
        "head_sha": head_sha,
        "tree_sha": tree_sha,
    }
    for key, value in expected.items():
        if candidate.get(key) != value:
            raise ValueError(f"Deployment candidate mismatch: {key}; run CI again on the current base")
    for key in ("head_sha", "merge_sha", "tree_sha"):
        if not re.fullmatch(r"[0-9a-f]{40}", candidate.get(key, "")):
            raise ValueError(f"Invalid candidate {key}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("record", "verify"))
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip()
    if args.operation == "record":
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        candidate = record(event["pull_request"], repository=os.environ["GITHUB_REPOSITORY"],
                           merge_sha=os.environ["GITHUB_SHA"], tree_sha=tree)
        args.path.write_text(json.dumps(candidate) + "\n")
    else:
        validate(
            json.loads(args.path.read_text()),
            repository=os.environ["GITHUB_REPOSITORY"],
            pr_number=int(os.environ["DEPLOYMENT_PR"]),
            head_sha=os.environ["DEPLOYMENT_HEAD_SHA"],
            tree_sha=tree,
        )
        print("Merged tree matches the successful deployment candidate")


if __name__ == "__main__":
    main()
