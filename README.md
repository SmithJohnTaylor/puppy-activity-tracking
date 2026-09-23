# 🐶 Puppy Log

A small web app for tracking a puppy's day: pee, poop, eating, drinking, naps, walks, play, training and accidents.
It shows how long it has been since each activity, and a timeline of everything logged.

**Live:** https://smithjohntaylor.github.io/puppy-activity-tracking/

The whole app is one static file (`index.html`) with no framework and no build step. It is hosted on GitHub Pages
and syncs data across devices by reading and writing a JSON file in this repo through the GitHub API.

---

## Using it

| Action | How |
|---|---|
| Log something now | Tap its card. A toast offers **Undo** and **Edit**. |
| Log something you forgot | Tap **＋ Log earlier** above the timeline, or long-press a card (that activity is preselected). Quick buttons: Now, 15m, 30m, 1h, 2h ago. Future times are rejected. |
| Log an accident | Tap **Accident**, then choose 💦 Pee, 💩 Poop or Both. This saves a pee/poop entry marked as an accident, so the Pee/Poop cards update too. |
| Edit or delete an entry | Tap it in the timeline. You can change the activity, time, note and accident checkbox. |
| Filter the timeline | Tap a chip. When filtered to one activity, each entry shows the time since the previous one (e.g. `+2h 15m`). |
| Set the puppy's name / turn on sync | ⚙️ Settings |
| Back up data | ⚙️ Settings → **Export JSON** |

Card colors show how long ago the activity last happened: green = recent, yellow = getting long, red = overdue.
The limits are `warnMin` / `staleMin` in the `ACTIVITIES` array at the top of the script. Accident has no limits,
so its card is never colored.

Tip: on iPhone, Safari → Share → **Add to Home Screen** makes it open like an app.

## Setting up sync

Without sync, data stays in the browser it was logged in (localStorage). To share data between phones and browsers:

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - **Repository access:** choose **Only select repositories** and pick this repo.
   - **Permissions:** under **Repository permissions**, click **Add permissions** and select **Contents**. Then change
     its **Access** from **Read-only** to **Read and write**. GitHub adds **Metadata: Read-only** automatically.
     Don't add any other permissions.
   - Set an expiration and click **Generate token**.
2. Open the app → ⚙️ → paste the token → Save. The header should show **✓ synced**.
3. Repeat on each device.

**Security:**
- The token is stored in plain text in each browser's localStorage. Scope it to this repo only.
- The repo is public (GitHub Pages on a free plan requires that), so anyone can read `events.json` on the `data` branch.

Sync status in the header: `local only` (no token), `syncing…`, `✓ synced`, `⚠ bad token` (401), `⚠ offline`.

---

## How it works (for developers)

### Repo layout

```
index.html        The entire app: HTML, CSS and JS inline
tests/e2e.mjs     Playwright end-to-end tests (fake GitHub API, two simulated devices)
package.json      Dev-only: Playwright + `npm test`
README.md
```

Branches:
- **`main`**: app code. GitHub Pages serves the repo root of `main`.
- **`data`**: holds only `events.json`, the synced data. It is separate so that each logged event doesn't trigger a Pages rebuild. Never merge it into `main`.

### Data model

Stored in localStorage under `puppylog.data`, and synced to `events.json`:

```json
{
  "events": [
    { "id": "uuid", "type": "pee", "ts": 1758631200000, "note": "", "accident": true, "updated": 1758631200000 }
  ],
  "deleted": ["uuid-of-a-deleted-event"]
}
```

- `type` is one of the ids in `ACTIVITIES`: `pee`, `poop`, `eat`, `drink`, `sleep` (shown as "Nap"), `walk`, `play`, `train`, `accident`.
- `ts` is when the activity happened; `updated` is when the entry was last changed. Both are epoch ms.
- **Accidents** are `pee`/`poop` entries with `accident: true`, not their own entries. `isAccident(e)` also treats
  `type: "accident"` as an accident. That covers entries logged before this change, which were never converted
  because there's no way to know whether they were pee or poop. When editing, "Accident" is offered as a type only for those older entries.
- `deleted` is a list of ids for deleted entries. It stays in the file so that a delete on one device also removes the entry from other devices.

Settings are stored in localStorage under `puppylog.cfg`: `{ name, repo, token }`. On `*.github.io`, `repo` defaults to
the owner and repo name taken from the URL.

### Sync algorithm (`sync()` in `index.html`)

1. `GET /repos/{repo}/contents/events.json?ref=data`. A 404 means no file yet, which is treated as empty.
2. `merge(local, remote)`: combine events by `id`. If both copies have the same id, the one with the higher `updated`
   is kept. Any id listed in `deleted` from either side is dropped.
3. If the merged result differs from what's on GitHub, `PUT` it back with the `sha` just read. A 409 or 422
   (someone else wrote in between) means read and merge again, up to 3 tries.

Sync runs 800ms after any change (so quick taps are batched), every 60s while the page is visible, and when the tab
regains focus. Failures never lose local data.

### Code map (`<script>` in `index.html`)

| Area | Key names |
|---|---|
| Activity definitions | `ACTIVITIES`, `ACT` |
| State and persistence | `data`, `cfg`, `save()`, `saveCfg()`, `commit()` (save + re-render + schedule sync) |
| Mutations | `addEvent(type, ts, note, extra)`, `updateEvent(id, patch)`, `deleteEvent(id)` |
| Accidents | `isAccident()`, `canBeAccident()`, `#accDlg` chooser, `accidentTs` |
| Rendering | `render()`: cards, filter chips, timeline grouped by day |
| Entry dialog | `showEntryDlg()`, `openEdit(id)`, `openNew(type)`; `editing` is an event id or `"new"` |
| Long-press | `pointerdown` timer on `#grid` (500ms); `longPressed` stops the tap from also logging |
| Toast | `toast(msg, evs)`: Undo works on several events, Edit only when there's one |
| GitHub sync | `gh()`, `pull()`, `sync()`, `schedulePush()`, `merge()` |

The page supports dark mode (`prefers-color-scheme`) and uses safe-area insets. It is built for a phone at 375px wide.

### To add a new activity

Add an entry to `ACTIVITIES` with `id`, `name`, `emoji`, `warnMin`, `staleMin`. No other change is needed:
cards, filters and the edit dialog are all built from that array. Never rename an existing `id`, because entries already saved use it.

---

## Development

### Run tests

```sh
npm install
npx playwright install chromium   # first time only, downloads headless Chromium
npm test
```

`tests/e2e.mjs` serves `index.html` from a local server and replaces the GitHub API with an in-memory fake
(it can simulate 404, 409 conflicts, 401 and offline). It then tests the app in two separate browser contexts
acting as two devices. It covers logging, undo, editing, log earlier, long-press, accidents, filters, persistence,
dark mode, sync between two devices, conflict retry, deletes syncing, bad token and offline recovery.
Screenshots are written to `tests/screenshots/` (gitignored). The last run: **78 passed, 0 failed**.

To view the app locally: `python3 -m http.server` in the repo root, then open http://localhost:8000.

### Deploy

Push to `main`. GitHub Pages rebuilds automatically in about 30–60s. To check the build:

```sh
gh api repos/SmithJohnTaylor/puppy-activity-tracking/pages/builds/latest -q '.status+" "+.commit'
```

Phones may cache the old page for a few minutes; pull down to refresh.

### Local environment note

On the owner's Mac, Node is installed through nvm with lazy loading, and `node`/`npm`/`npx` may not be on `PATH` for
non-interactive shells. If `node: command not found` or `_load_nvm` errors appear, call the binaries by full path
(`~/.nvm/versions/node/v23.11.0/bin/node`), or put `~/.nvm/versions/node/<version>/bin` on `PATH` in `~/.zshenv`.

---

## History

1. Initial app: tap to log, time since last per card, day-grouped timeline, filters, edit/delete, GitHub sync on the `data` branch.
2. **Log earlier**: long-press or ＋ link, quick time buttons, future times rejected.
3. **Accidents**: stored as pee/poop entries marked `accident: true`, chosen from a Pee/Poop/Both prompt. Also a
   toast width fix and no tap highlight on buttons.

Ideas not built yet: GitHub Action to run tests on push, stats (e.g. average time between pees, accidents per day),
a service worker for offline loading, several dogs.
