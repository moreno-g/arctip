// Bundles the Circle SDK facade into website/vendor/ as a single global script.
//
// The site itself stays build-free: this runs once when the SDK is added or
// upgraded, and the output is committed alongside ethers.umd.min.js and
// qrcode.min.js, which arrived the same way.
//
//   node tools/circle-bundle/build.js

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, "../../website/vendor/circle-passkey.js");

await build({
  entryPoints: [resolve(here, "entry.js")],
  outfile,
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "ArcTipPasskey_SDK",
  footer: {
    // esbuild puts the default export on `.default`; the site expects the
    // functions directly on the global.
    js: "ArcTipPasskey_SDK = ArcTipPasskey_SDK.default;",
  },
  target: ["es2022"],
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

const kb = (statSync(outfile).size / 1024).toFixed(0);
console.log(`built ${outfile} (${kb} KB)`);
