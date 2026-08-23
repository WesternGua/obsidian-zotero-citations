import esbuild from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const testFiles = ["csl-sync.test.ts", "issue6-regression.test.ts"];
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
      plugins: [{
        name: "obsidian-stub",
        setup(build) {
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
