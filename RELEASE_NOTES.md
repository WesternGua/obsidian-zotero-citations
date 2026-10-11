# Zotero Citations v0.3.1

## Locator controls in footnote previews

- When the Zotero item is not cached, the footnote preview attempts to fetch it before positioning locator controls. If the fetch fails, the original footnote text remains available and the existing fallback editing control may still appear.
- If a stored citation differs from the current CSL output, locator markers are placed only where the text can be aligned to an exact shared prefix or suffix. If alignment cannot establish a locator position, the preview does not attach its marker to a guessed number. The stored citation and handwritten commentary are not rewritten by this preview change.
- When the citation boundary is known but the locator is absent from the displayed citation, a compact add-locator control appears after the citation and before handwritten commentary. If the boundary cannot be established reliably, a fallback control may still be used.

## Preview responsiveness

- Hover previews no longer search every installed CSL style when positioning locator controls. They use the selected style for this task; explicit refresh and migration retain their existing style-discovery behavior.
- Footnote text is displayed before asynchronous locator-control work starts. This does not guarantee that item fetching or the controls complete immediately.

## Verification

- Regression tests cover missing item cache, changed citation text, ambiguous page numbers, commentary preservation, control placement and preview rendering order.

---

**Full Changelog**: [CHANGELOG.md](https://github.com/WesternGua/obsidian-zotero-citations/blob/0.3.1/CHANGELOG.md)
