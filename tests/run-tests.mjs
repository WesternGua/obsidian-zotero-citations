import esbuild from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const testFiles = ["csl-sync.test.ts", "issue6-regression.test.ts", "live-word-export.test.ts", "footnote-clipboard.test.ts", "citation-locator.test.ts", "compact-locator.test.ts", "citation-commentary.test.ts", "footnote-navigation.test.ts", "footnote-ui.test.ts", "all-fixes-regression.test.ts", "locator-preview-alignment.test.ts", "hover-commentary.test.ts"];
const outfiles = testFiles.map((_, index) =>
  path.join(os.tmpdir(), `zotero-citations-tests-${process.pid}-${index}.cjs`)
);

try {
  process.env.ZOTERO_CITATIONS_TEST_ROOT = root;
  for (let index = 0; index < testFiles.length; index++) {
    const outfile = outfiles[index];
    await esbuild.build({
      entryPoints: [path.join(root, "tests", testFiles[index])],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "es2018",
      outfile,
      loader: {
        ".lua": "text",
      },
      plugins: [{
        name: "obsidian-stub",
        setup(build) {
          build.onResolve({ filter: /^test-footnote-extension$/ }, () => ({
            path: path.join(root, "src", "extensions", "FootnoteExtension.ts"),
            namespace: "locator-test",
          }));
          build.onLoad({ filter: /.*/, namespace: "locator-test" }, ({ path: file }) => ({
            contents: fs.readFileSync(file, "utf8") + "\nexport { applyLocatorEdit, replaceInSourceView, mountLocatorEditor, showRenderedPopover, destroyActivePopover };",
            loader: "ts", resolveDir: path.dirname(file),
          }));
          build.onResolve({ filter: /^obsidian$/ }, () => ({
            path: path.join(root, "tests", "obsidian-stub.js"),
          }));
        },
      }],
    });
    await import(`${pathToFileURL(outfile).href}?t=${Date.now()}-${index}`);
  }
} finally {
  for (const outfile of outfiles) fs.rmSync(outfile, { force: true });
}
