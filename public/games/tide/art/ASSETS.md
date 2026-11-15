# The Turning Tide: artwork and sound checklist

Put every file in this folder (`public/games/tide/art/`), and sounds in `public/games/tide/sounds/`.
Anything missing is drawn by the game as a simple stand-in, so files can arrive in any order.

The game draws the card itself: the parchment frame, the colored force band, the numbers,
the names, the owner's colored border and the highlights. You supply the pictures that go on it.

## How cards look in this game

- **Cards are square.** Every chart location turns to face its owner, so cards appear upright,
  sideways and upside down. Square cards turn cleanly inside the 4×4 grid.
- **Small sizes matter.** On a phone a chart card is about 64 px wide, and the emblem
  in its middle is about 36 px. On a computer, cards are about 110–150 px. Use bold, simple shapes
  that still read when tiny.
- **The table is dark** (deep navy sea). Cards are cream parchment on top of it.

## 1. Force emblems (4 files), required

| File | Force | Element | Color the game paints it | Idea |
|---|---|---|---|---|
| `emblem-tide.svg`   | Tide   | Water | blue `#2573C9`  | a curling wave |
| `emblem-powder.svg` | Powder | Fire  | red `#D9442B`   | a powder keg bursting, or a cannon flash |
| `emblem-gale.svg`   | Gale   | Air   | gold `#C99A1E`  | a wind swirl, or a billowing sail |
| `emblem-stone.svg`  | Stone  | Earth | green `#4E8A3A` | a rocky reef or island |

These appear on all 56 Crew cards, as a small badge on the Signs, and in the
"Tide › Powder › Gale › Stone" cycle reminder.

**Format:**
- SVG (preferred) or PNG, square: `viewBox="0 0 256 256"`, or a 512×512 PNG.
- **Black on a transparent background.** The game paints the black in the force color. Gray
  shows as a lighter tint of that color, so you can use one gray for shading.
- Leave about 16 px of empty space around the drawing (out of 256).
- Lines at least 10 px thick (out of 256), so they survive at 36 px.
- No text, numbers or frames inside the emblem.
- Want different colors? Tell me four hex codes. They must be easy to tell apart, including for
  color-blind players, so the shapes should differ clearly too.

## 2. Captain's Sign emblems (12 files), required

One per zodiac sign, drawn the same way as the force emblems (black on transparent, square,
no text). The game paints each one in its force's color and adds the name, the number
and a small force badge.

| File | # | Sign | Force (paint color) | Pirate idea (optional) |
|---|---|---|---|---|
| `sign-1.svg`  | 1  | Aries       | Powder | ram figurehead |
| `sign-2.svg`  | 2  | Taurus      | Stone  | bull head |
| `sign-3.svg`  | 3  | Gemini      | Gale   | twin lookouts |
| `sign-4.svg`  | 4  | Cancer      | Tide   | crab |
| `sign-5.svg`  | 5  | Leo         | Powder | lion figurehead |
| `sign-6.svg`  | 6  | Virgo       | Stone  | maiden figurehead |
| `sign-7.svg`  | 7  | Libra       | Gale   | merchant's scales |
| `sign-8.svg`  | 8  | Scorpio     | Tide   | scorpion |
| `sign-9.svg`  | 9  | Sagittarius | Powder | archer, or a bow and arrow |
| `sign-10.svg` | 10 | Capricorn   | Stone  | sea-goat |
| `sign-11.svg` | 11 | Aquarius    | Gale   | water bearer, or an urn |
| `sign-12.svg` | 12 | Pisces      | Tide   | two fish |

## 3. Legendary Ship emblems (10 files), required

| File | # |
|---|---|
| `ship-0.svg` … `ship-9.svg` | 0–9 (one file per ship) |

- Same square format. Ships have **no force**, so the game shows them in **antique gold**
  (`#B8862B`) on a darker frame, to stand apart from the four forces.
  Black-on-transparent is best, but full-color art works too: name the file
  `ship-N.png`, and the game shows it as drawn without painting it.
- One ship is the **Sun Ship** (worth 10 for the tie-break). Give it a sun motif (a sun on the
  sail, gold rays) so players spot it.
- If you only make one ship picture, call it `ship.svg` and all ten will use it.
- Ship names are printed by the game, so send them as a list, not in the picture.

## 4. Card back (1 file), required

| File | Size | Format |
|---|---|---|
| `back.png` (or `back.jpg`) | 600×600 px, square | full color |

- Shown on the 16 hidden locations and on the draw pile.
- **It must look right in all four turns** (0°, 90°, 180°, 270°), so make it symmetrical
  in four directions, like a compass rose or a medallion on a sea pattern.
- Fill the whole square. The game rounds the corners and adds the border, so keep important
  detail at least 30 px from the edges.
- A medium-dark design, so the cream face-up cards stand out next to it.

## 5. Table background (1 file), optional

| File | Size | Format |
|---|---|---|
| `table.jpg` | 1600×1600 px, square | JPG, under 400 KB |

- An old sea chart or map under the 4×4 grid.
- Dark and low in contrast (it sits behind the cards, under a dark tint).
- Each player sees it turned to their own side, so avoid text or a clear "up" direction.

## 6. Card face texture (1 file), optional

| File | Size | Format |
|---|---|---|
| `face.png` (or `face.jpg`) | 600×600 px | light parchment, no drawing |

Replaces the plain cream of the card face. Keep it pale and even, because numbers and emblems
sit on top. It must also look fine turned in any direction.

## 7. Title logo (1 file), optional

| File | Size | Format |
|---|---|---|
| `logo.png` or `logo.svg` | about 1200×300 px | transparent background |

"The Turning Tide: A Pirate's Claim", shown about 40–56 px tall in the game's top bar, on dark navy.
Also used, smaller, on the game's card in the party room.

## 8. Sounds (5 files), optional

Put them in `public/games/tide/sounds/`. Use `.mp3` (or `.m4a`, `.ogg` or `.wav`), each under 100 KB,
at about the same loudness.

| File | When | Length | Idea |
|---|---|---|---|
| `scout`   | a hidden card is turned face up | under 1 s | card flip, splash |
| `board`   | a card is played over another   | under 1 s | grappling hook, thud |
| `capture` | a location changes owner        | under 1.5 s | cutlass clash, cannon |
| `turn`    | it becomes your turn            | under 1 s | ship's bell |
| `win`     | the game ends                   | up to 5 s | sea-shanty flourish |

## Quick checklist

- [ ] 4 force emblems: `emblem-tide`, `emblem-powder`, `emblem-gale`, `emblem-stone`
- [ ] 12 sign emblems: `sign-1` … `sign-12`
- [ ] 10 ship emblems: `ship-0` … `ship-9` (or one `ship`)
- [ ] card back: `back.png`
- [ ] optional: `table.jpg`, `face.png`, `logo.png`
- [ ] optional sounds: `scout`, `board`, `capture`, `turn`, `win`
- [ ] text list: 10 ship names, and which number is the Sun Ship
