# The Turning Tide: artwork and sound checklist

Put every picture in this folder (`public/games/tide/art/`), and sounds in `public/games/tide/sounds/`.
The game finds files by name. Anything missing is drawn as a simple stand-in, so files can
arrive in any order. After uploading, the new art shows up once Render redeploys.

## What the game draws, and what you paint

The game draws on top of your art:
- the **number** in the top-left corner and again, upside down, in the bottom-right corner,
  each on a small parchment label
- the **name** ("Tide", "Aries", "Sun Ship · 0") on a parchment label in the bottom-left
- a thin **force-colored stripe** along the top edge
- the **owner's colored border** around the whole card, plus glows for highlights

**So don't paint numbers, names or borders into your art.** You paint the picture.

## Card shape and how your art is used

- **Cards are square.** Chart cards turn to face their owner, so players see them upright,
  sideways and upside down. Square cards turn cleanly inside the 4×4 grid.
- **Every card picture is a 1024×1024 PNG** (JPG or WebP also work), full color, filling the
  whole square edge to edge. The game fits it into the card under the stripe and labels.
- **Keep the corners quiet.** The labels cover roughly the **top-left 28%**, the
  **bottom-right 28%**, and a strip along the **bottom-left** (about 60% wide, 14% tall).
  Put the main subject in the **middle 60%** of the square.
- **It must read when tiny.** On a phone a chart card is about 64 px wide. Use one bold,
  central subject with strong light and dark contrast, not fine detail. Test your picture
  shrunk to 64×64.
- **The table is a dark navy night sea.** Mid-tone to bright card art stands out best.
- **Keep the force recognisable.** Players have to tell the four forces apart at a glance,
  including color-blind players, so give each force a **dominant color** and a **distinct
  motif** (suggestions below). Cards of one force should look like they belong together.

## 1. Force art: 4 PNGs, required

One picture per force, used on all 14 Crew cards of that force.

| File | Force | Element | Suggested main color | Ideas |
|---|---|---|---|---|
| `emblem-tide.png`   | Tide   | Water | deep blue `#2573C9`   | a great curling wave, a sea serpent in the surf, a whirlpool |
| `emblem-powder.png` | Powder | Fire  | red-orange `#D9442B`  | a cannon blast, a powder keg bursting, a fire ship |
| `emblem-gale.png`   | Gale   | Air   | gold-yellow `#C99A1E` | billowing sails in a storm, a wind spirit, swirling clouds |
| `emblem-stone.png`  | Stone  | Earth | green `#4E8A3A`       | a jagged reef, a skull-shaped island, a stone fortress |

The game's stripe and label numbers use the color in the third column. If you paint the forces
in different main colors, tell me the four hex codes and I'll match them.

### 1b. Crew portraits: up to 56 PNGs, optional

To give individual Crew cards their own picture (a cabin boy for Tide 2, a sea witch for Tide 15),
name the file after the force and number. The card uses it instead of its force art:

`tide-2.png` … `tide-15.png`, and the same for `powder-`, `gale-` and `stone-`.

Add as few or as many as you like. Cards without their own picture use the force art.

## 2. Force badges: 4 PNGs, optional but recommended

| Files | Size |
|---|---|
| `badge-tide.png`, `badge-powder.png`, `badge-gale.png`, `badge-stone.png` | 256×256, **transparent background** |

A small, simple icon of each force (a wave, a flame, a wind swirl, a rock). It's shown about
16–24 px across: in a corner of each Captain's Sign card (showing which force it belongs to) and
in the "Tide › Powder › Gale › Stone" reminder. Keep it to one bold shape in the force's color.
Without badges the game uses its own simple icons.

## 3. Captain's Signs: 12 PNGs, required

Same format as the force art: 1024×1024, full color, quiet corners. The force badge goes in the
**top-right corner** of these cards, so keep that corner quiet too. Use the force's color as the
dominant tone, so a Sign is recognisably Powder, Stone, Gale or Tide.

| File | # | Sign | Force | Pirate idea (optional) |
|---|---|---|---|---|
| `sign-1.png`  | 1  | Aries       | Powder | a ram figurehead wreathed in cannon smoke |
| `sign-2.png`  | 2  | Taurus      | Stone  | a bull carved into a cliff |
| `sign-3.png`  | 3  | Gemini      | Gale   | twin lookouts in the crow's nest |
| `sign-4.png`  | 4  | Cancer      | Tide   | a giant crab rising from the waves |
| `sign-5.png`  | 5  | Leo         | Powder | a lion figurehead, mane of flame |
| `sign-6.png`  | 6  | Virgo       | Stone  | a maiden figurehead of stone |
| `sign-7.png`  | 7  | Libra       | Gale   | merchant's scales swinging in the wind |
| `sign-8.png`  | 8  | Scorpio     | Tide   | a scorpion on a sea-washed rock |
| `sign-9.png`  | 9  | Sagittarius | Powder | an archer loosing a burning arrow |
| `sign-10.png` | 10 | Capricorn   | Stone  | a sea-goat on a reef |
| `sign-11.png` | 11 | Aquarius    | Gale   | a water bearer pouring out a storm |
| `sign-12.png` | 12 | Pisces      | Tide   | two great fish circling |

## 4. Legendary Ships: 10 PNGs (or 1), required

| File | # | Notes |
|---|---|---|
| `ship-0.png` | 0 | **The Sun Ship.** Counts as 10. Give it a sun motif (a sun on the sail, golden rays) and make it the grandest ship. |
| `ship-1.png` … `ship-9.png` | 1–9 | One legendary ship each. |

Ships have **no force**, so don't make them read as blue, red, gold-yellow or green. Antique
gold, bronze, ivory, ghostly white or black all set them apart. The game gives Ship cards a gold
stripe and a warmer parchment.

Short on time? One picture named `ship.png` is used for every ship that has no picture of its own.

Ship names are printed by the game ("Ship 0" … "Ship 9" for now). If you name them later, send
the names as a list.

## 5. Card back: 1 PNG, required

| File | Size |
|---|---|
| `back.png` | 1024×1024, full color, edge to edge |

- Shown on the 16 hidden locations and the draw pile, so it's the most-seen picture in the game.
- **It must look right turned 0°, 90°, 180° and 270°.** Make it symmetrical in four directions:
  a compass rose, a medallion, a sea-chart rose, a pirate seal.
- The game adds a thin gold frame and rounds the corners, so keep detail about 60 px in from the edge.
- Medium to dark, so the parchment face-up cards stand out next to it.

## 6. Table: 1 picture, optional

| File | Size |
|---|---|
| `table.jpg` | 2048×2048, under 600 KB |

An old sea chart or map under the 4×4 grid. The game darkens it, so it can be detailed, but it
**must have no clear "up" direction and no text**, because every player sees it turned to their side.

## 7. Card face texture: 1 PNG, optional

| File | Size |
|---|---|
| `face.png` | 1024×1024, pale parchment, no drawing |

Shown behind the stand-in pictures and on any card without full-color art. Keep it pale and even,
and fine at any rotation. (Cards with full-color art don't show it.)

## 8. Title logo: 1 PNG, optional

| File | Size |
|---|---|
| `logo.png` | about 1600×400, transparent background |

"The Turning Tide: A Pirate's Claim". Shown about 44 px tall in the game's top bar on dark
navy, so the title must read at that size. A light or gold title works best.

## 9. Sounds: optional

In `public/games/tide/sounds/`. Use `.mp3` (or `.m4a`, `.ogg` or `.wav`), each under 100 KB, at about
the same loudness.

| File | When it plays | Length | Idea |
|---|---|---|---|
| `scout`   | a hidden card is turned face up | under 1 s   | card flip, splash |
| `board`   | a card is played over another   | under 1 s   | grappling hook, thud on deck |
| `capture` | a location changes owner        | under 1.5 s | cutlass clash, cannon |
| `turn`    | it becomes your turn            | under 1 s   | ship's bell |
| `win`     | the game ends                   | up to 5 s   | sea-shanty flourish |

## File size

Keep each 1024×1024 card PNG **under about 400 KB**. Export at 1024×1024 and compress it
(for example with TinyPNG), or save as WebP or JPG if there's no transparency. Phones load
every card picture at the start of a game.

## Quick checklist

Required:
- [ ] `emblem-tide.png`, `emblem-powder.png`, `emblem-gale.png`, `emblem-stone.png`
- [ ] `sign-1.png` … `sign-12.png`
- [ ] `ship-0.png` (Sun Ship) … `ship-9.png`, or a single `ship.png`
- [ ] `back.png`

Optional:
- [ ] `badge-tide.png`, `badge-powder.png`, `badge-gale.png`, `badge-stone.png`
- [ ] Crew portraits, such as `tide-2.png` … `stone-15.png`
- [ ] `table.jpg`, `face.png`, `logo.png`
- [ ] sounds: `scout`, `board`, `capture`, `turn`, `win`
- [ ] text: ship names, and hex colors if they differ from the suggestions above
