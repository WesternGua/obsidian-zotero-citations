# Zotero Citations v0.3.0

## Copy and paste passages with complete footnotes

- Normal copy/paste in Source mode and Live Preview now transfers referenced footnote definitions together with the selected passage, including multiline notes and grouped Zotero citations.
- Conflicting labels are renamed automatically, identical definitions are reused, and Zotero metadata, locators and handwritten commentary are preserved. One undo reverses both the passage and its added definitions.

## Compact locator editing and footnote navigation

- Locator values now appear as small editable boxes directly in the citation preview. Complete lists such as `159–174, 191–195, 341–344` stay together, and the input grows with its contents.
- The type menu supports all 27 Zotero locator types with matching names and ordering. Editing or clearing one locator preserves every other reference and locator in the group, together with the current cursor and reading position.
- Double-click a body footnote marker to jump to its definition; double-click the definition number to return to the originating occurrence, or the first reference when no origin is recorded.

## Preserve commentary and refresh complete citation groups

- Refresh, locator edits and Word export now preserve handwritten commentary after the generated citation, including multiple paragraphs. Existing citations are migrated only when the generated prefix can be confirmed; uncertain originals remain unchanged.
- All six citation mode transitions retain the complete citation group and its commentary, and document preferences read every grouped item when changing styles. Multi-paragraph footnotes remain unchanged when the destination inline format cannot preserve their paragraphs, with a clear explanation.
- Missing items and damaged locator metadata no longer interrupt updates to normal citations. A notice and an upper-right issue panel report the result, highlight affected citations, and provide an issue list, previous/next controls and return to the original location.
- Picker results are checked against the original document and file before insertion, preventing concurrent edits or tab changes from being overwritten. Legacy citation replacement uses the original item context to preserve commentary, and custom footnote labels are supported.
- Citation examples inside code, frontmatter and unrelated HTML comments are excluded from refresh, conversion and dynamic export. The in-plugin fallback search interface has been removed; native Zotero picker connection errors are reported directly.

## Reliable live Word exports

- The bundled Lua filter now uses the configured Zotero connection port instead of a fixed default and preserves complete Unicode dash ranges, multiple ranges and timestamps in live citation fields.
- Regression coverage includes grouped conversions, commentary preservation, clipboard conflicts, locator controls, issue navigation, concurrent edits and actual Pandoc DOCX field inspection with a custom-port Zotero test server.

---

**Full Changelog**: [CHANGELOG.md](https://github.com/WesternGua/obsidian-zotero-citations/blob/0.3.0/CHANGELOG.md)
