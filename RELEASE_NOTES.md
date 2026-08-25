# Zotero Citations v0.2.9

## Reliable live Zotero fields for custom CSL styles

- Word export now passes the exact URI of the CSL style installed in Zotero to Better BibTeX, including custom styles hosted outside the official Zotero style domain.
- Fixed UTF-8 percent encoding for non-ASCII style URIs in Pandoc's Lua runtime, so Chinese and other localized style identifiers resolve correctly.
- Fixed complex locators containing semicolons or closing brackets so every managed citation is converted into a live `ZOTERO_ITEM CSL_CITATION` field.
- Better BibTeX lookup failures now stop the export with an explicit error instead of silently leaving `[@citationKey]` as plain text in Word.
- Regression coverage now includes custom CSL style URIs, UTF-8 encoding, complex locators, and fail-fast Better BibTeX error handling.

---

**Full Changelog**: [CHANGELOG.md](./CHANGELOG.md)
