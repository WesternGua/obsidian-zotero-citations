# Development Guide

This plugin directory now follows a more standard Obsidian plugin source-repo layout while still remaining directly loadable by Obsidian.

## Directory Map

```text
zotero-citations/
├── assets/screenshots/       # README images
├── docs/                     # Project docs
├── src/                      # TypeScript source
│   └── vendor/               # Pinned third-party runtime sources bundled into main.js
├── tests/                    # CSL, citation, and live Word-export regression tests
├── CHANGELOG.md
├── LICENSE
├── README.md
├── README_zh.md
├── RELEASE_NOTES.md
├── esbuild.config.mjs
├── manifest.json
├── package.json
├── package-lock.json
├── styles.css                # Runtime stylesheet loaded by Obsidian
├── tsconfig.json
├── version-bump.mjs
├── versions.json
└── main.js                   # Generated build output used locally by Obsidian (kept untracked in Git)
```

## Local Workflow

```bash
npm install
npm run check
npm test
npm run build
```

The production build embeds the vendored Better BibTeX Pandoc live-citations
filter into `main.js`. Word export writes the filter to a temporary directory;
no extra release asset is required for the Lua source.

The vendored filter contains deliberate local patches in addition to the
removed online update check. They preserve UTF-8 byte encoding for custom CSL
style URIs, all locator types and timestamps, Unicode dash ranges, and make
Better BibTeX lookup failures abort the export. The configured connection port
is inserted into a temporary copy of the filter. Preserve or
reapply these patches when updating the pinned upstream filter.

DOM tests use Node jsdom and markdown-it, with a test-only renderer. Set
`ZOTERO_CITATIONS_DOM_TEST_RUNTIME` to a directory whose `node_modules`
contains those packages before running `npm test`. This exercises locator chips
and issue navigation without invoking Obsidian or another plugin's renderer.
The CodeMirror state tests also verify issue decorations and offset mapping.

For vault tests, create dedicated new Markdown notes through Obsidian CLI.
Do not test edits or Markdown rendering on existing user documents. Reload only
Zotero Citations, and do not change any other plugin or overwrite `data.json`.

After rebuilding, reload the plugin in Obsidian:

```bash
obsidian plugin:reload id=zotero-citations
```

## Important Local-Plugin Nuance

This folder is both:

1. a source repository layout, and
2. the live plugin directory under `.obsidian/plugins/`

So `main.js` must continue to exist locally for Obsidian to load the plugin, even though `.gitignore` excludes it from the GitHub source repository.

Likewise, `data.json` is local runtime state and should stay untracked. In contrast, `styles.css` is a real plugin asset and should stay versioned.

## Release Metadata

- 0.3.0 consolidates the unpublished 0.2.10 and 0.2.11 work. Neither receives a separate release entry.
- `manifest.json` stores the plugin version and minimum Obsidian version.
- `versions.json` maps each released plugin version to its minimum compatible Obsidian version.
- `npm version <patch|minor|major>` can use `version-bump.mjs` to keep `manifest.json` and `versions.json` in sync.

## Suggested Release Checklist

1. Run `npm run check`
2. Run `npm test`
3. Run `npm run build`
4. For live Word-export changes, inspect the generated DOCX for the expected number of `ADDIN ZOTERO_ITEM CSL_CITATION` fields and complete a Zotero Word Refresh smoke test
5. Update `CHANGELOG.md`
6. Bump the version with `npm version ...`
7. Confirm `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` use the release version
8. Update `RELEASE_NOTES.md` using the same English heading-and-bullets format as prior releases
9. Attach `main.js`, `manifest.json`, and `styles.css` to the GitHub release if distributing release artifacts
