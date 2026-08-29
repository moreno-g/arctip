// Per-handle share previews.
//
// Crawlers do not run JavaScript, so tip.html could only ever carry one generic
// Open Graph card: every creator's link previewed identically, with no name on
// it. For a product whose entire distribution is the shared link, that is the
// most expensive thing left on the page.
//
// This serves the same tip.html with the handle written into the meta tags. It
// is deliberately dumb — no RPC, no network, no dependencies — because it sits
// on the one path the product cannot afford to lose. Anything unexpected falls
// through to the untouched file rather than erroring.
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");

// Same rule the contract enforces in _validateHandle.
const HANDLE_RE = /^[a-z0-9_]{1,32}$/;

// The handle reaches the meta tags, so it gets escaped even though the regex
// above already excludes every character that matters. Two locks on the door
// that opens onto other people's timelines.
const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

let cachedHtml = null;

async function loadTemplate() {
  if (cachedHtml) return cachedHtml;
  cachedHtml = await readFile(join(process.cwd(), "tip.html"), "utf8");
  return cachedHtml;
}

module.exports = async (req, res) => {
  let html;
  try {
    html = await loadTemplate();
  } catch {
    // Cannot read the page at all — let the static file take over.
    res.status(302).setHeader("Location", "/tip.html");
    return res.end();
  }

  try {
    const raw = String((req.query && req.query.handle) || "").toLowerCase();
    if (HANDLE_RE.test(raw)) {
      const h = escapeHtml(raw);
      const title = `Tip @${h} in USDC on Arc`;
      const desc = `Send @${h} a tip in USDC. It lands in about a second — no account, no address to copy.`;
      const url = `https://arctip.app/@${h}`;

      html = html
        .replace(/(<title>)[^<]*(<\/title>)/, `$1${title}$2`)
        .replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`)
        .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
        .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
        .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
        .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`)
        // og:url is absent from tip.html; add it so the card links back properly.
        .replace(/(<meta property="og:site_name" content="ArcTip" \/>)/,
                 `$1\n  <meta property="og:url" content="${url}" />`)
        .replace(/(<link rel="stylesheet")/, `<link rel="canonical" href="${url}" />\n  $1`);
    }
  } catch {
    // Rewriting failed; the untouched page is still a working tip page.
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Short shared cache: previews stay fresh, and a crawler re-fetching soon
  // after a creator claims their handle sees the right card.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, must-revalidate");
  res.status(200);
  return res.end(html);
};
