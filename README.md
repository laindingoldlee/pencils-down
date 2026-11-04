# Game Night

Party games to play live with friends in the browser. One person starts a room and shares the link. Everyone else opens it, types a name, and they're in. No accounts needed.

In the room, everyone can tap emotes that float up above their avatar. The host picks a game and starts it for everyone.

## Games

- **Pencils Down**: a letter-and-categories word game. Starting it takes everyone from the room to the Pencils Down page; "Back to the party room" brings them back.
- **The Fifth Element**: five items, each with its own color. Each card shows two items. If one is in its own color, click it. If both are in the wrong color, cross out the items and colors on the card and click the one item left. Fastest correct click wins the card; a wrong click burns one of your cards. Between cards a ring fills up to show when the next one lands. Cards nobody wins carry over. Most cards wins, and a tie goes to sudden death. The host picks the deck size (30, 60, 90 or 120 cards) and the item set.
- **Black, White & Eleven**: tiles numbered 0 to 11 in black and white (plus blue, red, green and yellow for bigger groups). Everyone sees the color of every tile but only the numbers of their own. Draw a tile, point at someone's hidden tile and name it. They answer Yes or No, and a No can be a lie. Accept it and a chip goes into the Liar's Pot, or call the bluff and whoever was wrong flips as many tiles as there are chips. Right guesses let you keep going; wrong ones flip the tile you drew. Lose all your hidden tiles and you're out, with a kill-streak announcer. The host picks the number of colors (recommended: one per two players, at least two) and turns wildcards on or off.
- **Spellbound Mayhem (咒語大亂鬥)**, in Traditional Chinese: everyone sees the other players' spell stones but not their own. On your turn, name a spell you think you hold. Right: it's cast and you may keep going, but each guess in a turn must be the same or a higher number than the last spell you cast. Wrong: lose a life and your turn ends. Your rack is refilled after your turn. A round ends at the first knock-out or when someone casts every stone in their rack. Knocking someone out scores 3, casting all your stones scores 3, and if someone knocks themselves out everyone else scores 1. First to 10 wins. The host can change every number, including how many of each spell are in the game (spell n has n copies by default), turn the smallest-to-largest rule off, and turn on a hint showing how many of each spell could still be yours (off by default, so players count for themselves). The spell art is in `public/games/spellbound/art/`. Players sit around a round table; hover a spell (or hold it on a phone) to read what it does.
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

- `public/art/emotes/` holds the emote list.
- `package.json` lists the two libraries the server uses (Express and Socket.IO).

## Adding a new item set to The Fifth Element

1. Make a new folder in `public/games/fifth-element/themes/`, named with lowercase letters, numbers and dashes, for example `ocean`.
2. Put five item pictures in it. SVG works best: draw each item in **black on a transparent background**. The game paints them in the right color. Gray shading shows as a lighter version of the color.
3. Copy `theme.json` from the `magic` folder into it and change the name, the five items, their files and their colors (like `#E8402F`). The five colors must all be different.
4. Upload the folder. After Render redeploys, the host can pick the new set in the room. `magic` stays the default.

## Kill announcer sounds

Put recordings in `public/games/bw11/sounds/` named `single-kill`, `double-kill`, `triple-kill`, `quadra-kill`, `pentakill` (5 in one turn), `godlike` (6 or more), `executed` (knocked out by a called bluff), `first-blood` (first knock-out of the game), `ace` (the knock-out that leaves one player) and `slain` (heard by the player who was knocked out) (`.mp3`, `.m4a`, `.wav` or `.ogg`). Missing ones just show the words on screen with a short built-in sound.

## Changing the emotes

The 17 emotes are in `public/art/emotes/`, listed in `emotes.json` in the order they appear in the emote bar. To add or change one, put a picture in that folder (PNG, GIF, SVG or WebP with a transparent background; about 176 pixels wide keeps it quick to load) and add or edit its line in `emotes.json`: an `id`, a `label` and the `file` name. On phones the emotes open from an "Emotes" button at the bottom of the screen.

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
- Old Pencils Down links (`/ABCD`) now open a party room. Pencils Down itself lives at `/pencils-down/`.
- To change something later, upload the edited file to the same GitHub repository and Render redeploys on its own.

## Running it on your own computer

With Node.js 18 or newer installed, run `npm install` and then `npm start` in this folder, and open http://localhost:3000.
