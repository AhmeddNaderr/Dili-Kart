# Dili Cart — running and deploying

**Live:** https://dili-cart.pages.dev — to ship an update, run `npm run deploy`.

The game and its accounts API deploy together to **Cloudflare Pages**
(free tier). Scores live in **Cloudflare D1**, a hosted SQLite database.

## Run it locally

```bash
npm install
npm run dev
```

That starts the API (with a local database in `.wrangler/`) and the game at
http://localhost:5173. Accounts you create locally stay on your machine.

## Deploy (once)

1. Make a free Cloudflare account at https://dash.cloudflare.com/sign-up
2. Log the CLI in — it opens your browser:
   ```bash
   npx wrangler login
   ```
3. Create the database:
   ```bash
   npx wrangler d1 create dili-cart
   ```
   Copy the `database_id` it prints into `wrangler.toml`, replacing the zeros.
4. Create the Pages project:
   ```bash
   npx wrangler pages project create dili-cart --production-branch main
   ```
5. Ship it:
   ```bash
   npm run deploy
   ```
   This builds the game, applies the database schema, and uploads everything.
   Your game is live at `https://dili-cart.pages.dev`.

After that, `npm run deploy` is the only command you need for updates. It
applies any new database migrations first (for example `0003_skins.sql`, which
adds the coin wallet and skins and credits everyone the coins from races they
already ran), then uploads the site.

## What's stored

| Table      | What                                                             |
|------------|------------------------------------------------------------------|
| `players`  | Handle, password hash (PBKDF2 + salt), points, best score, wins, Dili-coin wallet, owned and equipped skins |
| `sessions` | A hash of each login token — never the token itself             |
| `races`    | One row per finished race                                         |
| `attempts` | Rate-limit counters for sign-ups and log-ins                      |

No email, wallet or personal data is collected.

## Useful commands

```bash
# Top 10 on the live board
npx wrangler d1 execute dili-cart --remote --command "SELECT handle, best, points FROM players ORDER BY best DESC LIMIT 10"

# Remove a player (and their races and sessions)
npx wrangler d1 execute dili-cart --remote --command "DELETE FROM players WHERE handle = 'somehandle'"
```
