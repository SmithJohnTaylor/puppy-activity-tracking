# Puppy Log

Read README.md first. It covers features, data model, sync algorithm, code map, testing and deploy.

- The whole app is `index.html` (inline CSS/JS, no framework, no build). Keep it that way.
- Deploy = push to `main` (GitHub Pages). Synced user data (`events.json`) lives in the private `-data` repo, on its `data` branch. This repo's old `data` branch still holds a copy: never merge it into `main` or overwrite it.
- Treat synced data as untrusted: escape every value from `events.json` before putting it in HTML.
- Run `npm test` (Playwright e2e, `tests/e2e.mjs`) after any change to `index.html`; add tests for new behavior.
- Never rename an existing activity `id` in `ACTIVITIES`, because saved entries reference it.
- Ask before pushing, since a push deploys to the live site.
