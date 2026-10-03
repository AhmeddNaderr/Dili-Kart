# DILI CART

A 3D kart racer from the Dlicom universe, made for the **Dlicom AI Game Jam**.

Race Dili Boy and the squad against seven Custodians around the Dlicom Grand
Prix: drift for blue → orange → purple turbos, grab items and coins, glide
over the lake, and climb the global leaderboard.

**Play:** https://dili-cart.pages.dev

## Controls

| Key | Action |
| --- | --- |
| ← → | Steer (hold a turn to drift, let go for a turbo) |
| ↑ | Gas |
| ↓ / Space | Use your item |
| Esc | Pause |

On phones, on-screen arrows appear automatically.

## Tech

- **Game:** TypeScript + Vite + Three.js. Every model, texture and sound is
  generated in code: no image or audio files.
- **Backend:** Cloudflare Pages Functions (`functions/api`) with a D1 (SQLite)
  database for accounts, races and the leaderboard. Passwords are hashed with
  PBKDF2; no email, wallet or personal data is collected.

```
src/kart      the race: track, world, karts, characters, effects, audio
src/ui        title screen and garage console, the start film player, menu 3D stages, Dili's intro, icons
src/app       API client (with offline queue and guest mode)
src/intro     dev-only renderer for the intro film (open /intro.html on the dev server)
src/trailer   dev-only trailer renderer (open /trailer.html on the dev server)
functions     the API
migrations    database schema
shared        rules shared by the game and the API
public/intro  the rendered intro film (1080p and 720p) and its poster
```

## The intro film

New visitors see a 31-second film before the title screen: Dili Boy walks up
to his kart, hops in, picks the Grand Prix on his dashboard and launches off
the ramp. It's rendered from the game itself, frame by frame, with depth of
field, motion blur, bloom and a film grade, and a soundtrack synthesised to
the edit. To render it again (needs Playwright and ffmpeg with libx264):

```bash
npm run dev:web                 # in one terminal
node tools/render-intro.cjs     # in another: frames, then public/intro/*.mp4
```

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173. The API runs under Wrangler with a local
database in `.wrangler/`.

## Deploy

See [DEPLOY.md](DEPLOY.md). After the one-time setup, `npm run deploy` builds,
migrates the database and publishes to Cloudflare Pages.

Race points are for fun and have no monetary value.
