"""Compatibility entry point for the Bun tool-package builder."""

from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
subprocess.run(["bun", "run", str(root / "scripts" / "package-vendor.ts")], cwd=root, check=True)
