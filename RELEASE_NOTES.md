# Zotero Citations v0.2.2

## Bug Fixes

- **Connection status false negative fixed** — Settings page now uses multiple probes to detect Zotero reliably (plugin API ping, connector ping, Better BibTeX endpoint fallback).
- **Style refresh parity fixed** — Settings page style selector now supports dynamic Zotero CSL style loading/refresh behavior aligned with the “Document Preferences / Change Citation Format” flow.
- **Footnote highlight rendering fixed** — `[^n]` markers now correctly inherit highlight in cases like `==你好吧[^1]。`, where highlight boundaries were previously misdetected.

## Improvements

- Added a **Refresh style list** control in plugin settings, with localized UI copy.

---

**Full Changelog**: [CHANGELOG.md](./CHANGELOG.md)
