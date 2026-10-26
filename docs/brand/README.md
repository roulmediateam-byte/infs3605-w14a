# Payprentice logo

## The idea

In the trades, a steel square checks that work is true. Our mark is a steel square turned 45 degrees, so it reads as a tick: the owner's OK, drawn with the tradie's own tool. And when every invoice is paid, you're "all square".

On stage, in one sentence: "Our logo is a builder's square turned into a tick: nothing goes out without your OK, and the goal is to get you all square."

## Files

Masters are SVG in `svg/`. The PNGs in `png/` are exports for slides and documents.

| File | Use it for |
| --- | --- |
| `payprentice-icon.svg` | The app icon at 96 px and up: the mark with its graduations on the brand-gradient tile |
| `payprentice-icon-small.svg` | The app icon at 64 px and down (browser tabs, the app's side bar): no graduations |
| `payprentice-icon-full-bleed.svg` | Square, no corners: phones round it themselves (`web/public/apple-touch-icon.png`) |
| `payprentice-icon-maskable.svg` | Android's shaped icons: the mark sits inside the safe zone (`web/public/icon-maskable-512.png`) |
| `payprentice-mark-*.svg` | The mark alone, in ink, indigo or white; `-small` is the cut without graduations |
| `payprentice-wordmark-*.svg` | The name alone, outlined, in ink or white; `-mono` makes the diamond the same colour |
| `payprentice-lockup.svg` | The main logo: icon and name, on white or light backgrounds |
| `payprentice-lockup-on-dark.svg` | Icon and white name, on ink or photographs |
| `payprentice-lockup-white.svg` | White mark and name, on the brand gradient |
| `payprentice-lockup-mono-ink.svg`, `-indigo.svg` | One-colour printing |

In the app, `web/src/ui/AppMark.tsx` draws the mark inline: the small cut in the side bar (32 px), and a white tile with the graduations on the gradient at sign-in (40 px, which high-density screens draw at 80 to 120 pixels). The browser and phone icons in `web/public/` come from these masters.

## Construction

- The mark is one closed outline: a steel square with a long arm (the blade) and a short arm (the tongue), turned 45 degrees.
- The tongue is half the blade's length. The blade is 0.2 of its length wide and the tongue 0.15, like a real square's 2-inch blade and 1.5-inch tongue.
- Four graduations are cut into the blade's inner edge, long and short in turn. Below 96 px use the small cut, which has none.
- In the tile, the mark's width is two thirds of the tile, centred by eye (halfway between the box's centre and the shape's centre of mass).
- The tile is a superellipse (exponent 5), so its corners curve continuously like a phone's icons.

## Colour

| Name | Hex | Use |
| --- | --- | --- |
| Action blue | `#1F4FD1` | The gradient's start (top left) |
| Apprentice indigo | `#4D3ED9` | The gradient's middle; the one-colour brand colour; the wordmark's diamond. White on it is 6.98:1 |
| Apprentice violet | `#6D28D9` | The gradient's end (bottom right) |
| Ink | `#0F172A` | The wordmark on light backgrounds; one-colour black |
| Indigo 300 | `#A5B4FC` | The diamond on dark backgrounds |

The gradient runs at 135 degrees, blue to violet, through indigo. It's the app's `--brand-gradient` in `web/src/styles.css`.

## Type

The name is set in Inter Display Bold, tracked in by 1.5 per cent and outlined, so the files need no font. The dot of the i is a small square turned 45 degrees: the mark's idea in one letter. In the app, the name is live text in Inter at weight 700. Inter is under the SIL Open Font Licence, which allows outlining it into a logo.

## Size and space

- Smallest: the icon at 16 px, the mark alone at 12 px, the lockup at 24 px tall.
- Keep clear space around the lockup equal to half the icon's height. Around the icon alone, keep a quarter of its width.

## Don't

- Don't rotate, flip or stretch the mark. It's already turned.
- Don't redraw the arms, change their proportions or move the graduations.
- Don't add outlines, glows, bevels or shadows to the mark. In the app, the sign-in panel's white tile casts a soft shadow; that's the one exception.
- Don't put the gradient tile on the gradient. Use the white tile or the white lockup there.
- Don't use the old envelope-and-tick mark.

## Before using it outside the course

The team hasn't checked this mark against registered trade marks. Search IP Australia (classes 9 and 42) for the name and the mark before using it outside INFS3605.

Made with Claude, an AI assistant. Team W14A-5 reviews and owns it.
