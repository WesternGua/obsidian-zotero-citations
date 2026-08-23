import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@electron/remote",
    "@codemirror/view",
    "@codemirror/state",
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: "main.js",
  platform: "node",
  loader: {
    ".lua": "text",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(prod ? "production" : "development"),
  },
}).catch(() => process.exit(1));
