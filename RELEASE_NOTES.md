# Zotero Citations v0.2.3

## Community review follow-ups

- **README language flow reversed** — `README.md` is now the English primary document, with a link to the Chinese guide (`README_zh.md`).
- **CSS lint improvements** — removed `!important` usage and `:has()` selectors from `styles.css` to improve compatibility and performance.
- **Popout compatibility hardening** — timer/window handling in search/export modals and footnote popovers now uses active-window-aware fallbacks.
- **UI construction cleanup** — result rows and footnote marker elements now use Obsidian-friendly element creation patterns.
- **Build-environment robustness** — added `pnpm.onlyBuiltDependencies` for `esbuild` to reduce build-install failures in constrained CI/review sandboxes.

---

**Full Changelog**: [CHANGELOG.md](./CHANGELOG.md)
