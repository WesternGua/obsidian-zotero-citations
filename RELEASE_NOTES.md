# Zotero Citations v0.2.4

## In-text citation mode + Word export behavior

### ✨ What's new

- Added a third citation mode: **In-text** (alongside Footnote and Endnote).
- In-text citations are inserted as author-year text in the paragraph while keeping Zotero metadata for refresh/style switching.

### 🧠 Obsidian behavior

- In-text mode now uses a footnote-compatible managed structure internally, so citations remain plugin-manageable.
- Metadata markers are hidden from normal reading/editing rendering (no visible `<!-- zotero... -->` clutter).

### 📄 Word export

- Export pipeline now preprocesses in-text citations before Pandoc conversion.
- Result: in-text citations are exported as **paragraph text**, not Word footnotes.
- Footnote/endnote modes keep their note structure as before.

### 📝 Docs

- Updated `README.md` and `README_zh.md` with the new mode and export semantics.

---

**Full Changelog**: [CHANGELOG.md](./CHANGELOG.md)
