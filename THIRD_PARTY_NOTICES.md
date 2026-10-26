# Third-party notices

The web app's look (web/src/styles.css, from the visual refresh of Fri 23 Oct 2026) copies values and one font file from the open-source projects below. Each is used under its licence, and each licence's notice is kept here, as those licences ask. Nothing is copied from the AGPL, Elastic or Business Source products the team studied for ideas (Midday, Maybe, Lago, Plane, Dub, Documenso, Formbricks, Invoice Ninja, Akaunting), and nothing from Shopify Polaris, whose licence limits use to Shopify apps.

| What the app uses | Where it is | Source | Licence |
|---|---|---|---|
| Inter 4.0, the Latin variable font file (one file, every weight) | `web/src/assets/fonts/inter-latin-wght-normal.woff2`, from the npm package `@fontsource-variable/inter` 5.3.0 | [rsms/inter](https://github.com/rsms/inter) | SIL Open Font License 1.1, shipped with the app as `web/public/fonts/OFL.txt` (served at `fonts/OFL.txt`) |
| Colour values: the slate greys and the red, amber, green, blue, sky and violet tones | `:root` in `web/src/styles.css` | [Tailwind CSS v3.4.17 `colors.js`](https://github.com/tailwindlabs/tailwindcss/blob/v3.4.17/src/public/colors.js) | MIT |
| The corner-radius scale, derived from one `--radius: 0.625rem` | `:root` in `web/src/styles.css` | [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT |
| The resting, floating and dialog shadows | `:root` in `web/src/styles.css` | [Primer Primitives](https://github.com/primer/primitives) | MIT |
| Icons, imported one by one by name | `lucide-react` 1.57.0 (a dependency since the app was built) | [Lucide](https://github.com/lucide-icons/lucide) | ISC, with MIT for the icons that came from Feather |
| The logo's wordmark, outlined from Inter Display Bold (Inter 4.0), with the i's dot redrawn | `docs/brand/svg/payprentice-wordmark-*.svg` and the lockups | [rsms/inter](https://github.com/rsms/inter) | SIL Open Font License 1.1, which allows outlining glyphs into artwork such as a logo |

The action blue `#1f4fd1`, the field edge `#7b8494` and the app's mark, the steel-square tick (`web/src/ui/AppMark.tsx`, `web/public/icon.svg`, `docs/brand/`), are the team's own.

## Inter

Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)

This Font Software is licensed under the SIL Open Font License, Version 1.1. The full licence is in `web/public/fonts/OFL.txt` and at http://scripts.sil.org/OFL. The font is bundled with the app, never sold on its own, and keeps its name.

## Tailwind CSS

MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## shadcn/ui

MIT License

Copyright (c) 2023 shadcn

The permission notice and disclaimer are the same as Tailwind CSS's, above.

## Primer Primitives

MIT License

Copyright (c) 2018 GitHub Inc.

The permission notice and disclaimer are the same as Tailwind CSS's, above.

## Lucide

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

The icons Lucide derived from Feather are also under the MIT License, Copyright (c) 2013-present Cole Bemis, with the same permission notice and disclaimer as Tailwind CSS's, above. The list of those icons is in `lucide-react`'s own LICENSE file.
