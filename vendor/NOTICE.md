# Bundled command-line tools (Windows x64)

The editor runs these programs as separate processes. Their binaries and
upstream program source archives are inside `tools-win-x64.br`; on first use
the editor unpacks them into its settings directory under `%APPDATA%`. No Mario
Kart Wii game files are included.

The package uses solid Brotli compression; every tool binary, runtime file,
license and upstream source archive is kept intact.

- **ABMatt 1.3.2**, by Robert Nelson, is GPL-3.0 licensed. The archive contains
  the unmodified command-line executable and its required runtime files from
  [the official Windows release](https://github.com/Robert-N7/abmatt/releases/tag/v1.3.2),
  plus its `LICENSE`, `README.md`, and `source.tar.gz`. The original release ZIP
  has SHA-256 `7b4f74dcd2f22b1bc47532b76210628bfe46904e49e1358d8b5a9186b67554e2`.
  The source archive is the upstream `v1.3.2` tag.
- **Wiimm's SZS Tools 2.42a r8989**, by Dirk Clemens, is GPL-2.0-or-later
  licensed. The archive contains the unmodified `wszst.exe` and `wimgt.exe`,
  the Cygwin DLLs needed to run them, `gpl-2.0.txt`, and `source.tar.gz`.
  The binaries are from [the official Cygwin x64 ZIP](https://szs.wiimm.de/download.html),
  SHA-256 `ac54b82806d5867d2d9f003df972164138ae4f7a7ab8f29d8397664f31c9e892`.
  The matching source is upstream commit `246fdb38d7c2fb3054b8f8528e11dc8f17691750`.
  The Cygwin runtime and support DLLs retain their own licenses; see
  [Cygwin's licensing information](https://cygwin.com/licensing.html) and
  [source packages](https://cygwin.com/packages/).

- **Kinoko**, by vabold and contributors, is MIT licensed (`kinoko-LICENSE.txt`).
  `ghost-path.exe` is `native/ghost-path/main.cc` built on
  [Kinoko](https://github.com/vabold/Kinoko) commit
  `e16728c77e29ffb6e300e7060f8aa48610fe9c52` by `scripts/build-ghost-path.ts`, linked statically
  with the GCC runtime of MSYS2's UCRT64 toolchain (GCC Runtime Library Exception). It is not
  packed with the tools above: the editor copies it to its settings directory and runs it there.

The editor's own code remains under MIT. The bundled programs retain their own
licenses. The package also contains ABMatt's and Wiimm's original license texts and
upstream source archives so recipients of the single-file editor can inspect
their program code.
