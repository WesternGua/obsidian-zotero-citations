# Zotero Citations v0.2.8

## Live Zotero citations in Word exports

- Word exports now convert plugin-managed footnote, endnote, and in-text citations into live `ZOTERO_ITEM CSL_CITATION` fields that can be refreshed and restyled by Zotero.
- Managed reference lists are exported as live `ZOTERO_BIBL` bibliography fields instead of static text.
- Exported documents store the full URI of the CSL style currently selected from Zotero, together with Zotero's locale and the correct note type, so Zotero Refresh uses the same style.
- Citation-key conversion is performed only in a temporary Markdown copy, leaving the original Obsidian note unchanged.
- The Better BibTeX Pandoc filter is bundled at a pinned upstream revision with its online update check removed, and export errors now identify missing Better BibTeX connections, styles, or citation keys.

---

**Full Changelog**: [CHANGELOG.md](./CHANGELOG.md)
