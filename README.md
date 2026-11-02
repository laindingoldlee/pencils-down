# Game Night

Party games to play live with friends in the browser. One person starts a room and shares the link. Everyone else opens it, types a name, and they're in. No accounts needed.

In the room, everyone can tap emotes that float up above their avatar. The host picks a game and starts it for everyone.

## Games

- **Pencils Down**: a letter-and-categories word game. Starting it takes everyone from the room to the Pencils Down page; "Back to the party room" brings them back.
- **The Fifth Element**: five items, each with its own color. Each card shows two items. If one is in its own color, click it. If both are in the wrong color, cross out the items and colors on the card and click the one item left. Fastest correct click wins the card; a wrong click burns one of your cards. Between cards a ring fills up to show when the next one lands. Cards nobody wins carry over. Most cards wins, and a tie goes to sudden death. The host picks the deck size (30, 60, 90 or 120 cards) and the item set.
- **Black, White & Eleven**: tiles numbered 0 to 11 in black and white (plus blue, red, green and yellow for bigger groups). Everyone sees the color of every tile but only the numbers of their own. Draw a tile, point at someone's hidden tile and name it. They answer Yes or No, and a No can be a lie. Accept it and a chip goes into the Liar's Pot, or call the bluff and whoever was wrong flips as many tiles as there are chips. Right guesses let you keep going; wrong ones flip the tile you drew. Lose all your hidden tiles and you're out, with a kill-streak announcer. The host picks the number of colors (recommended: one per two players, at least two) and turns wildcards on or off.
- The Carpet Trap and Spellbound Mayhem are coming soon.

## What's in here

- `server.js` runs the website and the party rooms (players, host, emotes, starting games).
- `games/pencils-down.js` is the Pencils Down game server. `public/pencils-down/index.html` is its page.
- `games/fifth-element.js` is The Fifth Element game server (cards, scoring, sudden death). `public/games/fifth-element/` has its page code, styles and item sets.
- `public/index.html` and `public/hub.js` are the party room page.
- `package.json` lists the two libraries the server uses (Express and Socket.IO).

## Adding a new item set to The Fifth Element

1. Make a new folder in `public/games/fifth-element/themes/`, named with lowercase letters, numbers and dashes, for example `ocean`.
2. Put five item pictures in it. SVG works best: draw each item in **black on a transparent background**. The game paints them in the right color. Gray shading shows as a lighter version of the color.
3. Copy `theme.json` from the `magic` folder into it and change the name, the five items, their files and their colors (like `#E8402F`). The five colors must all be different.
4. Upload the folder. After Render redeploys, the host can pick the new set in the room. `magic` stays the default.

## Kill announcer sounds

Put recordings in `public/games/bw11/sounds/` named `single-kill`, `double-kill`, `triple-kill`, `quadra-kill`, `pentakill` (5 in one turn), `godlike` (6 or more), `executed` (knocked out by a called bluff), `first-blood` (first knock-out of the game), `ace` (the knock-out that leaves one player) and `slain` (heard by the player who was knocked out) (`.mp3`, `.m4a`, `.wav` or `.ogg`). Missing ones just show the words on screen with a short built-in sound.

## Changing the emotes

The emote list is `public/art/emotes/emotes.json`. Each emote shows its emoji until it has a picture. To use your own picture, put it in `public/art/emotes/` (PNG, GIF, SVG or WebP, square, transparent background, about 256×256) and add `"file": "laugh.png"` to that emote.

## Putting it online for free (Render)

You need a free GitHub account and a free Render account. It takes about 15 minutes the first time.

1. **Put the files on GitHub.** Sign in at github.com and create a new repository called `pencils-down`. On the empty repository page, click **uploading an existing file**. Drag in everything from this folder: `server.js`, `package.json`, `package-lock.json`, `README.md`, and the `public` and `games` folders. Click **Commit changes**.
2. **Create the web service on Render.** Sign up at render.com (signing up with GitHub is easiest). Click **New**, then **Web Service**, and pick your `pencils-down` repository.
3. **Fill in the settings:**
   - Language: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
4. Click **Deploy**. After a few minutes Render shows your address, something like `https://pencils-down-ab12.onrender.com`. Open it, start a room and send the link to your friends.

## Good to know

- The free server goes to sleep after 15 minutes with nobody playing. The first person to open the link after that waits about a minute while it wakes up. Open it a minute before game night.
- Rooms live only in the server's memory. If Render restarts the server, each page reconnects and the room comes back with the same code. A Pencils Down game carries on where it was; a Fifth Element game in progress ends and everyone is back in the room.
- Up to 20 people per room, and 12 per Pencils Down game.
- To change something later, upload the edited file to the same GitHub repository and Render redeploys on its own.

## Running it on your own computer

With Node.js 18 or newer installed, run `npm install` and then `npm start` in this folder, and open http://localhost:3000.
