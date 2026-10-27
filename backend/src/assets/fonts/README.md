# Living Business Plan PDF fonts

Bundled for offline server-side PDF creation; no runtime network/font fetches.
Unmodified upstream binaries, downloaded 26-Oct-2026 (America/Los_Angeles).
Both are SIL Open Font License 1.1; each complete upstream license is alongside its font.

| File | Official upstream | SHA-256 |
| --- | --- | --- |
| NotoSans-Regular.ttf | https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf | b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5 |
| NotoEmoji.ttf | https://github.com/google/fonts/blob/main/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf | de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551 |

Noto Sans supplies extended Latin, Greek and Cyrillic glyphs. Noto Emoji supplies
monochrome emoji, including supported joined and skin-tone sequences. Fontkit
checks each grapheme's coverage before rendering. Text is never stripped.
Scripts outside the bundled fonts (for example CJK) receive an explicit browser
Print / Save as PDF fallback rather than a damaged download.

`scripts/copy-assets.js` copies this directory into `dist/assets/fonts`; the API
Docker build already copies all of `dist`. PDFKit embeds only used glyph subsets.
Fontkit 2.0.4 was already a PDFKit dependency and is now declared directly because
the coverage checks use its public API.
