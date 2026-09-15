const { build } = require("esbuild");
const path = require("path");

Promise.all([
  build({
    entryPoints: [path.join(__dirname, "src/index.ts")],
    bundle:      true,
    minify:      true,
    platform:    "browser",
    target:      ["es2020"],
    outfile:     path.join(__dirname, "dist/widget.js"),
    globalName:  "CryptoPay",
  }),
  // Separate chunk — WalletConnect's libraries are large; loaded on-demand
  // only when a buyer actually clicks that option, not on every page load.
  build({
    entryPoints: [path.join(__dirname, "src/walletconnect-entry.ts")],
    bundle:      true,
    minify:      true,
    platform:    "browser",
    target:      ["es2020"],
    outfile:     path.join(__dirname, "dist/walletconnect-chunk.js"),
  }),
]).then(() => {
  console.log("✅ widget.js + walletconnect-chunk.js built");
}).catch(e => { console.error(e); process.exit(1); });
