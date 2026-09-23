# Puppy Log

Read README.md first. It covers features, data model, sync algorithm, code map, testing and deploy.

- The whole app is `index.html` (inline CSS/JS, no framework, no build). Keep it that way.
- Deploy = push to `main` (GitHub Pages). The `data` branch holds synced user data (`events.json`); never merge it into `main` or overwrite it.
- Run `npm test` (Playwright e2e, `tests/e2e.mjs`) after any change to `index.html`; add tests for new behavior.
- Never rename an existing activity `id` in `ACTIVITIES`, because saved entries reference it.
- Ask before pushing, since a push deploys to the live site.
