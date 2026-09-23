# 🐶 Puppy Log

Tiny static web app for tracking a puppy's activities (pee, poop, eat, drink, nap, walk, play, training, accidents).

- Tap a card to log it now. Toast lets you undo or edit the time.
- Cards show time since last occurrence, colored green / yellow / red.
- Timeline grouped by day. Filter by activity to see gaps between events. Tap an entry to edit or delete.

## Sync

Data always lives in the browser (localStorage). To sync across devices, open ⚙️ Settings and paste a
[fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) scoped to
**only this repo** with **Contents: Read and write**. Events are stored in `events.json` on the `data`
branch (so logging doesn't trigger Pages rebuilds).

Note: if the repo is public, `events.json` is publicly readable.
