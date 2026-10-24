# Pencils Down

A live letter-and-categories word game for friends. One person starts a game and shares the link. Everyone else opens it, types a name, and plays. No accounts needed.

## What's in here

- `server.js` is the game server. It keeps each game in memory, runs the timer, collects answers and votes, and adds up the scores.
- `public/index.html` is the page everyone plays on.
- `package.json` lists the two libraries the server uses (Express and Socket.IO).

## Putting it online for free (Render)

You need a free GitHub account and a free Render account. It takes about 15 minutes the first time.

1. **Put the files on GitHub.** Sign in at github.com and create a new repository called `pencils-down`. On the empty repository page, click **uploading an existing file**. Drag in everything from this folder: `server.js`, `package.json`, `package-lock.json`, `README.md`, and the `public` folder. Click **Commit changes**.
2. **Create the web service on Render.** Sign up at render.com (signing up with GitHub is easiest). Click **New**, then **Web Service**, and pick your `pencils-down` repository.
3. **Fill in the settings:**
   - Language: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
4. Click **Deploy**. After a few minutes Render shows your address, something like `https://pencils-down-ab12.onrender.com`. Open it, start a game and send the link to your friends.

## Good to know

- The free server goes to sleep after 15 minutes with nobody playing. The first person to open the link after that waits about a minute while it wakes up. Open it a minute before game night.
- Games live only in the server's memory. If Render restarts the server, any game in progress ends and everyone starts a new one.
- Up to 12 players per game.
- To change something later, upload the edited file to the same GitHub repository and Render redeploys on its own.

## Running it on your own computer

With Node.js 18 or newer installed, run `npm install` and then `npm start` in this folder, and open http://localhost:3000.
