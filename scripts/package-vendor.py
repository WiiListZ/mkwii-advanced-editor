"""Rebuild vendor/tools-win-x64.zip from verified, extracted upstream releases.

Inputs are staged under .cache/vendor-downloads; see vendor/NOTICE.md for their
versions and URLs. This script keeps only the command-line binaries and their
runtime dependencies, then includes matching upstream source archives.
"""

from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
staged = root / ".cache" / "vendor-downloads"
output = root / "vendor" / "tools-win-x64.zip"

files = []
for folder, prefix in [(staged / "abmatt-cli", "abmatt"), (staged / "wiimm-cli", "wiimm")]:
    if not folder.is_dir():
        raise SystemExit(f"Missing staged tool directory: {folder}")
    files += [(path, f"{prefix}/{path.relative_to(folder).as_posix()}")
              for path in folder.rglob("*") if path.is_file()]
for source, name in [("abmatt-v1.3.2-source.tar.gz", "abmatt/source.tar.gz"),
                     ("wiimm-v2.42a-source.tar.gz", "wiimm/source.tar.gz")]:
    path = staged / source
    if not path.is_file():
        raise SystemExit(f"Missing source archive: {path}")
    files.append((path, name))
files.append((root / "vendor" / "NOTICE.md", "NOTICE.md"))

with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for path, name in sorted(files, key=lambda item: item[1]):
        info = ZipInfo(name, date_time=(2024, 3, 26, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
print(f"Created {output} ({output.stat().st_size:,} bytes, {len(files)} files)")
