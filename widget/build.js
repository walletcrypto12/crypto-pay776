const { build } = require("esbuild");
const path = require("path");

build({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  bundle:      true,
  minify:      true,
  platform:    "browser",
  target:      ["es2017"],
  outfile:     path.join(__dirname, "dist/widget.js"),
  globalName:  "CryptoPay",
}).then(() => {
  console.log("✅ widget.js built");
}).catch(e => { console.error(e); process.exit(1); });
