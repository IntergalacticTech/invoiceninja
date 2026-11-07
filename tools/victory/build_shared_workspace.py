"""Package canonical team-app screens with explicit, host-only adapters.

Run after editing native screens, then repack workspace-ui. CI uses --check to
reject divergence between canonical sources, generated files and archive bytes.
"""

from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "victory-ui/src"
TARGET = ROOT / "workspace-ui/src/team"
ADAPTERS = ROOT / "workspace-ui/host-adapters/team"
HOST_ADAPTERS = {"api/client.ts", "auth/session.tsx", "router.ts", "api/documents.ts"}
SEEDS = (
    "pages/ProjectsPage.tsx",
    "pages/ProjectPage.tsx",
    "components/TaskDetails.tsx",
    "components/Toasts.tsx",
)


def canonical_files() -> dict[str, bytes]:
    """Follow relative TS imports, replacing only the explicit host boundary."""
    pending = [SOURCE / name for name in SEEDS]
    seen: set[str] = set()
    while pending:
        path = pending.pop()
        name = str(path.relative_to(SOURCE))
        if name in seen:
            continue
        seen.add(name)
        if name in HOST_ADAPTERS:
            continue
        for specifier in re.findall(r"from ['\"]([^'\"]+)['\"]", path.read_text()):
            if not specifier.startswith("."):
                continue
            base = path.parent / specifier
            candidates = (base, Path(str(base) + ".ts"), Path(str(base) + ".tsx"))
            dependency = next((candidate for candidate in candidates if candidate.is_file()), None)
            if dependency is None:
                raise RuntimeError(f"Cannot resolve shared screen import {specifier} from {name}")
            pending.append(dependency.resolve())
    return {
        str((TARGET / name).relative_to(ROOT)): (
            ADAPTERS / name if name in HOST_ADAPTERS else SOURCE / name
        ).read_bytes()
        for name in sorted(seen)
    }


def verify_archive(expected: dict[str, bytes]) -> None:
    version = json.loads((ROOT / "workspace-ui/package.json").read_text())["version"]
    archive = ROOT / f"victory-ui/vendor/victory-workspace-{version}.tgz"
    manifest = json.loads((ROOT / "victory-ui/package.json").read_text())
    assert manifest["dependencies"]["@victory/workspace"] == f"file:vendor/victory-workspace-{version}.tgz"
    with tarfile.open(archive) as package:
        # Include host CSS, adapters, and public exports, not just canonical JSX.
        for path in (ROOT / "workspace-ui/src").rglob("*"):
            if path.is_file():
                member = "package/" + str(path.relative_to(ROOT / "workspace-ui"))
                packed = package.extractfile(member)
                assert packed is not None and packed.read() == path.read_bytes(), f"Stale packed file: {path}"
        for name, content in expected.items():
            member = "package/" + str(Path(name).relative_to("workspace-ui"))
            packed = package.extractfile(member)
            assert packed is not None and packed.read() == content, f"Stale packed screen: {name}"


def main() -> None:
    expected = canonical_files()
    fingerprints = {name: hashlib.sha256(content).hexdigest() for name, content in expected.items()}
    check = "--check" in sys.argv
    if check:
        for name, content in expected.items():
            assert (ROOT / name).read_bytes() == content, f"Regenerate shared screen: {name}"
        assert json.loads((ROOT / "workspace-ui/shared-screens.json").read_text()) == fingerprints
        verify_archive(expected)
    else:
        for name, content in expected.items():
            path = ROOT / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        (ROOT / "workspace-ui/shared-screens.json").write_text(json.dumps(fingerprints, indent=2) + "\n")
    subprocess.run(
        ["node", str(ROOT / "tools/victory/scope_workspace_styles.mjs"), *(["--check"] if check else [])],
        check=True,
    )
    print("CANONICAL_SHARED_SCREENS_VERIFIED", len(expected))


if __name__ == "__main__":
    main()
