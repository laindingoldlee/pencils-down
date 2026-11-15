# Game Night

Party games to play live with friends in the browser. One person starts a room and shares the link. Everyone else opens it, types a name, and they're in. No accounts needed.

In the room, everyone can tap emotes that float up above their avatar. The host picks a game and starts it for everyone.

## Games

- **Pencils Down**: a letter-and-categories word game. Starting it takes everyone from the room to the Pencils Down page; "Back to the party room" brings them back.
- **The Fifth Element**: five items, each with its own color. Each card shows two items. If one is in its own color, click it. If both are in the wrong color, cross out the items and colors on the card and click the one item left. Fastest correct click wins the card; a wrong click burns one of your cards. Between cards a ring fills up to show when the next one lands. Cards nobody wins carry over. Most cards wins, and a tie goes to sudden death. The host picks the deck size (30, 60, 90 or 120 cards) and the item set: Magic (the default), Space, Pirate treasure, Enchanted forest, Bakery, Underwater, Weather, Music, Camping, Dinosaurs, Garden insects or Medieval fantasy.
- **Black, White & Eleven**: tiles numbered 0 to 11 in black and white (plus blue, red, green and yellow for bigger groups). Everyone sees the color of every tile but only the numbers of their own. Draw a tile, point at someone's hidden tile and name it. They answer Yes or No, and a No can be a lie. Accept it and a chip goes into the Liar's Pot, or call the bluff and whoever was wrong flips as many tiles as there are chips. Right guesses let you keep going; wrong ones flip the tile you drew. Lose all your hidden tiles and you're out, with a kill-streak announcer. The host picks the number of colors (recommended: one per two players, at least two) and turns wildcards on or off.
- **Spellbound Mayhem (咒語大亂鬥)**, in Traditional Chinese: everyone sees the other players' spell stones but not their own. On your turn, name a spell you think you hold. Right: it's cast and you may keep going, but each guess in a turn must be the same or a higher number than the last spell you cast. Wrong: lose a life and your turn ends. Your rack is refilled after your turn. A round ends at the first knock-out or when someone casts every stone in their rack. Knocking someone out scores 3, casting all your stones scores 3, and if someone knocks themselves out everyone else scores 1. First to 8 wins. Calling spell 1 without having it spins a 1-2-3 wheel and costs that many lives. Spells 6, 7 and 8 hit the players sitting on your left and right (as they sit around the table on screen). The host can change every number, including how many of each spell are in the game (spell n has n copies by default), turn the smallest-to-largest rule off, and turn on a hint showing how many of each spell could still be yours (off by default, so players count for themselves). The spell art is in `public/games/spellbound/art/`. Players sit around a round table; hover a spell (or hold it on a phone) to read what it does.
- **The Ember Crown**: a deduction game for 3 or 4 players. Everyone holds a secret hand of Adventurer cards (five 0s, five 1s, one each of 2–9). On your turn, scout a face-down center card, play an Adventurer for its ability (spy on hands, steal a named card, make rivals discard, and more), or challenge a rival by naming their whole hand. A right challenge knocks them out and scores their hand size, and you can keep challenging. Last one standing ends the round; first to 15 renown wins. A "What you know this round" panel keeps track of everything you've secretly learned. The host picks Renown or Last Adventurer Standing, the target score or number of rounds, and the advanced Ember Wraith card (which counts as both 0 and 1).
- **Countercurrent: The Pelagos Protocol**, for 3 or 4 players: 14 compound samples (2 crimson, 3 amber, 4 jade, 5 cobalt). Each round two are sealed away as the formula and the rest are dealt out. On your turn, move your Field Team to one of seven reaction profiles (the six colour pairs, plus "same colour"), but not the one it was on last turn, and use an unused protocol with its colours: Scan (give one A, it comes back, and they privately tell you how many B they hold), Transfer (give one A, get all their B), Synthesize (get one of each colour, if they have them), Acquire (name a colour, get one if they have one) or Declare. On the same-colour profile you name the colour. A cycle is one turn per protocol, then they all come back. When someone declares, the others in turn may claim a different profile, back a claimed one or pass: right claim +3, right back +1, wrong back −1 at once, and a wrong claim loses your claim marker for the round (the last team with a marker must declare). Card colours stay private to the two teams involved; how many cards move is public. The host picks the protocols (Introductory: Scan and Declare; Standard: Transfer, Acquire and Declare; Full: all five), the points to win (6) and the Trace analysis rule (after a protocol, secretly bet on a formula colour: +1 or −1). A private Notes grid stands in for paper and pencil.
- **The Triple Seven**: everyone has a row of face-down cards (3 to start) and peeks at one. On your turn, draw a card and play it, or keep it in place of one of your cards and play that one instead. Played cards' powers always happen: A adds a card to anyone's row, 2 spies on a row, 3 shows you your own row, 6 repeats the last power (except a 7's Remove), 7 removes one of your cards (and counts 0), 8 skips the next player, 9 gives another turn, 10 turns a card face up for everyone, J peeks, Q swaps two cards, K locks or unlocks a card, Joker swaps two players' rows. Lowest total wins (7 = 0, A = 1, J/Q/K/Joker = 10). The round ends when the pile runs out, or a lap after someone calls last round (+10 if the caller isn't lowest). The host picks the number of decks, rounds, whether calling is allowed, the penalty, which powers are on, and whether cards you've looked at stay shown (faded) or flip back after 5 seconds. Players sit around a round table.

## What's in here

- `server.js` runs the website and the party rooms (players, host, emotes, starting games).
- `public/index.html` and `public/hub.js` are the home page and the party room.
- Each game has its rules and scoring on the server in `games/`, and its screen in `public/games/<game>/` (`client.js` and `style.css`):

  | Game | Server | Screen |
  |---|---|---|
  | Pencils Down | `games/pencils-down.js` | `public/pencils-down/index.html` (its own page) |
  | The Fifth Element | `games/fifth-element.js` | `public/games/fifth-element/` (plus item sets in `themes/`) |
  | Black, White & Eleven | `games/black-white-eleven.js` | `public/games/bw11/` (plus announcer `sounds/`) |
  | Spellbound Mayhem | `games/spellbound.js` | `public/games/spellbound/` |
  | The Triple Seven | `games/triple-seven.js` | `public/games/t7/` |
  | The Ember Crown | `games/ember-crown.js` | `public/games/ember-crown/` (plus `art/` and `sounds/`) |
  | Countercurrent | `games/countercurrent.js` | `public/games/countercurrent/` (plus pictures in `art/`) |

- `public/art/emotes/` holds the emote list.
- `package.json` lists the two libraries the server uses (Express and Socket.IO).

## Adding a new item set to The Fifth Element

1. Make a new folder in `public/games/fifth-element/themes/`, named with lowercase letters, numbers and dashes, for example `ocean`.
2. Put five item pictures in it. SVG works best: draw each item in **black on a transparent background**. The game paints them in the right color. Gray shading shows as a lighter version of the color.
3. Copy `theme.json` from the `magic` folder into it and change the name, the five items, their files and their colors (like `#E8402F`). The five colors must all be different.
4. Upload the folder. After Render redeploys, the host can pick the new set in the room. `magic` stays the default.

## The Ember Crown's card art and sounds

The game ships with its own art. To replace a picture, put a file in `public/games/ember-crown/art/` with these names (`.webp`, `.png`, `.jpg` or `.svg`):

- `card-0` Apprentice, `card-1` Warrior, `card-2` Barbarian, `card-3` Duelist, `card-4` Shadow Hunter, `card-5` Princess Knight, `card-6` Doomblade, `card-7` Spirit Caller, `card-8` Plague Doctor, `card-9` Water Goddess, `card-wraith` Ember Wraith
- `card-back` for every face-down card
- `crown` (title logo), `renown` (score icon), `eliminated` (stamp on a knocked-out player), `table` (table texture)

Card pictures should be portrait, 5:7 (for example 600 × 840 pixels), illustration only. The game draws the number in the top-left corner and the name along the bottom, so keep those areas fairly plain. Any picture you leave out keeps its drawn version.

Sounds go in `public/games/ember-crown/sounds/` (`.mp3`, `.m4a`, `.wav` or `.ogg`, under 2 seconds): `play-card`, `scout`, `challenge-wrong`, `eliminated`, `water-goddess`, `round-end`, `game-win`. Missing ones use a short built-in tone. Restart the server (or let Render redeploy) after adding files.

## Countercurrent pictures

The retro sci-fi art set is already in `public/games/countercurrent/art/` (converted to WebP and resized to the sizes the game shows, about 560 KB in all). The game draws simple stand-ins for any picture that's missing. To replace a picture, put PNG, WebP or JPG files in `public/games/countercurrent/art/` with these names (any one of them can be left out):

| File name | What it is | Suggested size |
|---|---|---|
| `sample-crimson`, `sample-amber`, `sample-jade`, `sample-cobalt` | Sample card faces | 400×560, portrait |
| `card-back` | Back of a sample card (hidden formula) | 400×560 |
| `compound-crimson`, `compound-amber`, `compound-jade`, `compound-cobalt` | Round compound icons, transparent background, used on the profiles | 256×256 |
| `profile-0` … `profile-6` | Whole reaction-profile cards, if you'd rather draw them: 0 crimson+amber, 1 crimson+jade, 2 crimson+cobalt, 3 amber+jade, 4 amber+cobalt, 5 jade+cobalt, 6 same colour | 400×300 |
| `protocol-scan`, `protocol-transfer`, `protocol-synthesize`, `protocol-acquire`, `protocol-declare` | Protocol tile icons | 256×256 |
| `marker-field`, `marker-claim`, `marker-trace`, `marker-first` | Marker icons: **black on a transparent background** (the game colours them; Field Team and claim markers take each player's colour) | 128×128 |
| `formula` | The sealed-formula vault, shown above the two hidden cards | 400×400 |
| `table` | Table background (shown darkened) | 1920×1080 |
| `logo` | Title banner across the top; the game writes the title over its middle, so keep a plain band there | about 1400×400 |

After Render redeploys, the new pictures show up.

## Kill announcer sounds

Put recordings in `public/games/bw11/sounds/` named `single-kill`, `double-kill`, `triple-kill`, `quadra-kill`, `pentakill` (5 in one turn), `godlike` (6 or more), `executed` (knocked out by a called bluff), `first-blood` (first knock-out of the game), `ace` (the knock-out that leaves one player) and `slain` (heard by the player who was knocked out) (`.mp3`, `.m4a`, `.wav` or `.ogg`). Missing ones just show the words on screen with a short built-in sound.

## Changing the emotes

The 17 emotes are in `public/art/emotes/`, listed in `emotes.json` in the order they appear in the emote bar. To add or change one, put a picture in that folder (PNG, GIF, SVG or WebP with a transparent background; about 176 pixels wide keeps it quick to load) and add or edit its line in `emotes.json`: an `id`, a `label` and the `file` name. Hover an emote to see its name. On phones the emotes open from an "Emotes" button at the bottom of the screen, with each name under its picture; the grid closes by itself a few seconds after your last emote or when you tap elsewhere.

## Putting it online for free (Render)

You need a free GitHub account and a free Render account. It takes about 15 minutes the first time.

1. **Put the files on GitHub.** The code needs to be on the `main` branch of your GitHub repository (merge the pull request with the new games into `main`). If you're starting from scratch instead: create a repository, click **uploading an existing file**, and drag in `server.js`, `package.json`, `package-lock.json`, `README.md`, and the `public` and `games` folders.
2. **Create the web service on Render.** Sign up at render.com (signing up with GitHub is easiest). Click **New**, then **Web Service**, and pick your `pencils-down` repository.
3. **Fill in the settings:**
   - Language: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
4. Click **Deploy**. After a few minutes Render shows your address, something like `https://pencils-down-ab12.onrender.com`. Open it, start a room and send the link to your friends.

If Pencils Down is already running on Render from this repository, you don't need to do anything else: once the new code is on `main`, Render updates on its own and the address stays the same.

## Good to know

- The free server goes to sleep after 15 minutes with nobody playing. The first person to open the link after that waits about a minute while it wakes up. Open it a minute before game night.
- Rooms live only in the server's memory. If Render restarts the server (it does on every update), each page reconnects and the room comes back with the same code. A Pencils Down game carries on where it was; any other game in progress ends and everyone is back in the room. Avoid updating the site during game night.
- Up to 20 people per room, and 12 per Pencils Down game.
- If someone's phone drops out mid-game, the game waits a little, then plays or skips their turn for them, so nobody is stuck waiting.
- On a computer, every game in the room fits the browser window without scrolling: the table stretches to fit, and with a big group the whole game shrinks a little if needed. "What happened" and "How to play" are drop-downs in each game's top bar.
- Old Pencils Down links (`/ABCD`) now open a party room. Pencils Down itself lives at `/pencils-down/`.
- To change something later, upload the edited file to the same GitHub repository and Render redeploys on its own.

## Running it on your own computer

With Node.js 18 or newer installed, run `npm install` and then `npm start` in this folder, and open http://localhost:3000.
