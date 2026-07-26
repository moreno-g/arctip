# ArcTip — website

Static site. No build step: the HTML, CSS and JS are served as-is, and every
dependency is vendored into `vendor/` rather than pulled from a CDN at runtime.

```
index.html      landing page
app.html        creator dashboard — claim a handle, get your link, QR and share card
tip.html        public tip page, served for /@handle by a rewrite
404.html        not found, with handle lookup
js/config.js    network details and the deployed TipJar address — edit here on redeploy
js/wallet.js    wallet connection, chain verification, RPC failover
js/app.js       dashboard logic, QR and share card generation
js/tip.js       tip page logic
```

## Deploying

```bash
npx vercel --prod
```

Root directory must be `website`.

## Notes on `vercel.json`

Vercel's config is strict JSON with no comments allowed, so the reasoning lives
here:

- **`/@:handle` rewrite** — serves `tip.html` without changing the address bar.
  That means no query string reaches the client, which is why `tip.js` reads the
  handle from `location.pathname` first and only falls back to `?handle=`.
- **`/js/` and `styles.css` revalidate on every request** — the filenames are
  stable and their contents change with each deploy, so a returning visitor
  would otherwise keep running an old build against a possibly new contract.
- **`/vendor/` and `/fonts/` are immutable for a year** — pinned by version and
  never edited in place.

## Contract

The address lives in `js/config.js` and must be updated whenever the contract is
redeployed. See `../contracts`.
