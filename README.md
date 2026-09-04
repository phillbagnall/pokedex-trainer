# Pokedex Trainer

A flashcard study app and searchable database covering every Pokémon,
Generations 1–9 (National Dex #1–1025), with official artwork.

No build step, no dependencies, no server. Serve the folder as static files
and open `index.html`.

## Getting it on a phone

This is the main way it's meant to be used. Publish this repo as static
files behind whatever you already use to serve your own domain (a plain
web server or reverse proxy — this is just static HTML/CSS/JS), then on
the phone:

- **iPhone (Safari)** — open the URL, Share button → *Add to Home Screen*.

It then launches full screen from the home icon, with no browser bars. A
service worker caches the app shell on first visit and caches each
Pokémon's artwork the first time it's viewed, so it keeps working with no
signal — Pokémon you haven't looked at yet just won't have images until
you're back online.

### Running it on a computer

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## What's in it

- **Browse** — search by name, filter by generation and type, and sort by
  dex number, name, type, evolutionary family (each evolution line stays
  grouped together, base → final), or weakest-first (your own accuracy).
  Tap a card for full details: stats, height/weight, abilities, evolution
  chain, and your study history for that Pokémon.
- **Study** — two flashcard modes:
  - **Picture → Name** — a silhouette of the artwork; type the name to
    reveal it. Answers are graded automatically (typos in punctuation are
    forgiven), with a manual "I got it right anyway" button for edge cases.
  - **Name/Type → Details** — multiple choice on a random fact: a base
    stat, what it evolves into, its other type, or one of its abilities.
- **Progress** — how many Pokémon you've studied, overall accuracy, how
  many are in each of the 5 study boxes, and which types/generations are
  weakest.

### How studying tracks progress

A simple 5-box [Leitner system](https://en.wikipedia.org/wiki/Leitner_system),
stored only in this browser's `localStorage` — no accounts, nothing sent
anywhere:

| Box | Comes back due |
|---|---|
| 1 (new or just missed) | next day |
| 2 | 2 days later |
| 3 | 4 days later |
| 4 | 7 days later |
| 5 (well known) | 14 days later |

Get one right → it moves up a box and comes back further out. Get one
wrong → it drops straight back to box 1. Opening **Study** always leads
with whatever's due today; Browse can filter to "due for review only" or
sort "weakest first" too.

## Cross-device sync

By default progress lives only in one browser's `localStorage`, same as
everything else in this app. There's also an optional sync feature: a
short code (no account, no password) that lets progress follow her from
her phone to a laptop and back. Since progress is just quiz stats and
nothing sensitive, this is deliberately lightweight - whoever has the
code can read or overwrite it.

Because this needs *something* to hold the shared data, it's the one
part of this app that isn't purely static files - it needs
[`server/index.mjs`](server/index.mjs) running somewhere. It's a small,
dependency-free Node HTTP server storing everything in one JSON file (no
database to run), so hosting it is light, but it does need to actually be
running and reachable from the internet for sync to work from outside
your home network.

**1. Run the server** on your home server, next to (or on the same box
as) wherever you're already self-hosting things:

```sh
cd server
docker build -t pokedex-sync .
docker run -d --name pokedex-sync -p 8791:8791 -v pokedex-sync-data:/app/data pokedex-sync
```

(Or just `node server/index.mjs` directly if you'd rather not use Docker
— same env vars, `PORT` and `DATA_DIR`, apply either way.)

**2. Expose it through your reverse proxy** the same way you're already
exposing this site and Home Assistant - point a subdomain (e.g.
`sync.yourdomain.com`) or a path at container port `8791`, so it gets a
real HTTPS URL.

**3. Point the app at it.** Edit the `API_BASE` constant at the top of
[`js/sync.js`](js/sync.js) to that URL, then commit and push (or redeploy
however you're hosting the static site - it doesn't need to be the same
host as the sync server, `API_BASE` can point anywhere).

Once that's done, **Progress → Sync across devices** lets her tap "Start
syncing" to get a code (shown on screen, with a copy button), then enter
that same code under "Join" on any other device to pull that progress
across.

After that first join, it's automatic in the common case: every answer
pushes to the server (debounced), and *opening the app* on any synced
device reconciles with the server first - pushing anything answered
locally, then pulling the latest - so switching from phone to laptop and
back should just work without her having to remember to tap anything.
"Sync now" is there for re-pulling mid-session (e.g. she knows the laptop
has moved on and wants this device caught up right now) - unlike the
open-the-app reconcile, that one skips the push and just overwrites this
device with the server's copy, so only use it when this device has
nothing of its own worth keeping since the last sync. The one gap this
doesn't cover: two devices both answering *offline* before either goes
back online - whichever reconciles second wins, and the other's offline
answers are lost. Fine for this app's actual use (practice on the phone,
catch up on the laptop later), not built for simultaneous use on two
devices.

## Updating the Pokémon data

`data/pokemon.json` is generated, not hand-written — see
[`scripts/fetch-pokemon-data.mjs`](scripts/fetch-pokemon-data.mjs). To
regenerate it (e.g. once a new generation exists):

```sh
node scripts/fetch-pokemon-data.mjs
```

It pulls PokéAPI's own CSV data dump from GitHub, joins it locally, and
writes `data/pokemon.json` — no API keys, no npm install. Needs Node 18+.

## Files

```
index.html                 markup for all three screens
css/styles.css              all styling
js/dataset.js                loads data/pokemon.json, filter/sort/lookup helpers
js/typechart.js               type effectiveness chart (weak to / resists)
js/sound.js                   synthesised correct/wrong sound cues
js/sync.js                    cross-device progress sync client (see below)
js/progress.js               Leitner-box localStorage store
js/browse.js                 search/filter/sort grid + detail overlay
js/flashcards.js             all three study modes
js/app.js                    tab routing, progress screen, update checks
data/pokemon.json            generated dataset (~215 KB)
manifest.webmanifest         app name, icons and colours when installed
sw.js                        service worker — offline app shell + sprite caching
icons/                       home screen icons
scripts/fetch-pokemon-data.mjs   maintainer-only data generation script
server/                      optional self-hosted sync server (see below)
```

### Updating it after a change

The service worker serves the cached copy first and refreshes in the
background, so a change appears the *second* time it's opened. To see it
immediately, bump `CACHE` in `sw.js` to a new version string.
