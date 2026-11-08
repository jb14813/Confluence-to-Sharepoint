# File import artwork

`logo.svg` is original project artwork created in 2026 for the file-import
feature: a blue document with a folded teal corner and two white content lines.
It was drawn directly as native SVG paths and rectangles for this project.
It contains no third-party logos, wordmarks, fonts or embedded raster images.
The artwork is distributed under the repository license.

`icons/logo.svg` is an identical copy. The PNGs are rendered directly from this
vector source into a transparent canvas, once for each target size.

Regenerate from any working directory with:

```sh
node /path/to/repository/products/file-to-sharepoint/scripts/generate-icons.mjs
```

The generator uses the repository's Playwright dependency and native Chrome SVG
rasterization, with `CHROME_PATH` overriding standard installed Chrome detection.
The 16/32/48 icons have 0/1/2 pixels of padding; the 128 icon has 16 pixels; the
512 logo has 16 pixels. The renderer centers the visible artwork in each square.

These assets belong to the file-import feature. The standard Confluence
extension's toolbar icon and main logo are maintained separately.
