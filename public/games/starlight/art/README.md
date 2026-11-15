# Starlight Signal art

Drop files in this folder and they replace the placeholders after the next deploy. No code changes needed.
Names are lowercase with dashes. SVG, PNG, WebP, JPG or GIF.

## Needed

| File name | What it is | Size |
|---|---|---|
| `star-crimson`, `star-amber`, `star-jade`, `star-cobalt` | One star of each colour. The game places 1 to 5 of them on a card. Give each colour its own shape too (the placeholders use a 5-, 4-, 6- and 8-point star), so colour-blind players can tell them apart. | Square, 256×256 or bigger, transparent background |
| `card-crimson`, `card-amber`, `card-jade`, `card-cobalt` | Blank card front for each colour (border, sky texture, corners) with no stars. Keep the middle quiet so the stars stand out. | Portrait, 500×700 |
| `comet` | The comet card: a large comet, no stars | Portrait, 500×700 |
| `back` | The back of every card (the face-down piles) | Portrait, 500×700 |
| `bell` | The signal bell in the middle of the table | Square, 512×512, transparent |
| `background` | The night-sky table behind everything | About 1920×1080, fairly dark |
| `logo` | The title in the game's top bar | Wide, about 1200×300, transparent |

## Optional

| File name | What it is | Size |
|---|---|---|
| `card-crimson-1` … `card-cobalt-5` | Fully painted card faces (20 of them). Used instead of the stars-on-a-blank-card version. | Portrait, 500×700 |
| `bell-ring` | The bell mid-ring. Shown for a moment when someone rings. | Same as `bell` |
| `comet-slot` | Empty comet outline beside the bell | Portrait, about 250×350, transparent |
| `comet-glow` | An overlay across the table while the comet is showing | 1920×1080, transparent |
| `target-5`, `target-4` | "Ring at 5" and "Ring at 4" badges in the top bar | Wide or square, transparent, shown 28px tall |
| `eliminated` | Badge on a knocked-out player's seat | Square, 256×256, transparent |
| `winner` | Trophy or constellation on the end screen | Square, 512×512 or bigger |

Example: `star-jade.png`, `card-cobalt.webp`, `bell.svg`.

## Sounds

Put these in `../sounds/` (mp3, m4a, wav, ogg or webm): `flip`, `bell-right`, `bell-wrong`, `comet`, `collect`, `out`, `win`.
Without them the game plays simple built-in beeps (and nothing for `collect`).
