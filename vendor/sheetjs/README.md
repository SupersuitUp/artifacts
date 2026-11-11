# SheetJS Community Edition, vendored

The file page draws a spreadsheet's first sheet in the reader's browser with this build
(`src/artifacts/sheet-view.tsx`, loaded only by a dynamic import on mount; the server never loads it).
SheetJS CE is not on the npm registry, so it is pinned here.

- Version: 0.20.3
- Source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
  (tarball SHA-256 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`)
- File: `package/xlsx.mjs` from that tarball, unchanged, as `xlsx.mjs`
  (SHA-256 `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db`).
  It reads xlsx, xls, csv and ods.
- License: Apache-2.0, `LICENSE` from the same tarball, unchanged.
- `xlsx.d.mts` is ours: the few calls this package makes.

To update: fetch the new pinned tarball from cdn.sheetjs.com into an empty folder, check its SHA-256,
copy `package/xlsx.mjs` and `package/LICENSE` here, and change the numbers above.
