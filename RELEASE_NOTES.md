# Zotero Citations v0.2.7

## Zotero CSL synchronization and endnote fixes

- Citation styles are now read exclusively from Zotero's installed CSL styles, with no built-in fallback styles or approximate formatter.
- Fixed IEEE webpage references so access dates, online markers, URLs, locale-specific quotation marks, and punctuation follow Zotero's CSL configuration.
- Added dependent-style resolution, Zotero locale and article-URL preference synchronization, bibliography sorting, and multi-item citation clusters.
- Fixed duplicate endnotes and adjacent insertion in endnote mode. Identical item-and-locator citations reuse the existing endnote, while inserting beside a marker no longer overwrites its definition.
- Styles removed from Zotero are no longer reused from cache, and regression tests now cover Issues #5 and #6.

---

**Full Changelog**: [CHANGELOG.md](./CHANGELOG.md)
