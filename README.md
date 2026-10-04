# Zotero Citations

> Manage Zotero citations in Obsidian with footnote/endnote modes, Word-style display, and one-click export to Word with live Zotero citation fields.

[简体中文](./README_zh.md)

---

## Highlights

- **Insert citations** — Invokes Zotero's native citation picker, with support for page/paragraph locators
- **Footnote / endnote / in-text** — Freely switch between footnote mode (`^[citation text]`), endnote mode (`[^1]` + endnote definitions), and in-text mode (plain-text author-year citations)
- **Word-style display** — Footnote markers render as superscript numbers in the editor; hover to preview the full citation and edit locators
- **Zotero-only CSL styles** — Shows and uses only styles currently installed in Zotero; there are no built-in or approximate fallback styles
- **Matching CSL output** — Uses Zotero's style files and locale rules, including dependent styles, bibliography sorting, and citation clusters
- **Bibliography** — Auto-generates a formatted reference list from all citations in the current document
- **Copy with footnotes** — Normal copy/paste transfers complete footnote definitions, resolves label conflicts, and preserves Zotero metadata
- **Export to Word** — Uses Pandoc and a bundled Better BibTeX Lua filter to create `.docx` files whose footnote, endnote, and in-text citations remain live Zotero fields that can be refreshed and restyled
- **Bilingual UI** — Switch between Chinese and English in settings

---

## Prerequisites

| Component | Description |
|-----------|-------------|
| Obsidian Desktop 1.5.7+ | Desktop-only plugin (`isDesktopOnly: true`) |
| [Zotero](https://www.zotero.org/) | Reference manager; should be running |
| [Better BibTeX](https://github.com/retorquere/zotero-better-bibtex/releases) | Zotero plugin that provides the API layer |
| [Pandoc](https://pandoc.org/installing.html) (optional) | Required only for Word export |

---

## Installation

1. Download the following files from the GitHub Releases page:
   - `main.js` — plugin runtime
   - `manifest.json` — plugin manifest
   - `styles.css` — plugin styles
2. Place the files into your vault's `.obsidian/plugins/zotero-citations/` directory (create it if it does not exist)
3. Enable **Zotero Citations** in Obsidian Settings → Community plugins
4. Make sure Zotero is running and Better BibTeX is installed
5. (For Word export) Install Pandoc and ensure it is on your system PATH

---

## Compatibility Note

This version has been developed and tested primarily on **macOS**. Linux and Windows have not yet been fully validated, so UI rendering, window focus behavior, native dialogs, and export-related workflows may behave differently and are not guaranteed to be perfectly compatible at this stage.

---

## Disclosures

- **Network use**: the plugin talks to Zotero / Better BibTeX over the local loopback address `127.0.0.1`; it does not rely on a plugin-operated remote server.
- **External files and executables**: the plugin reads the local Zotero styles directory; in fallback scenarios it may copy and read the local Zotero database in the system temp directory; for Word export it invokes the local `pandoc` executable; for database fallback parsing it may invoke the local `sqlite3` executable; on macOS it may invoke the system `osascript` command to return focus to Obsidian after the Zotero picker closes.
- **Local data storage**: the plugin stores settings and citation cache data in Obsidian's plugin data storage.
- **Accounts / payments / ads / telemetry**: the plugin does not require an account, does not include ads, does not include in-app payments, and does not intentionally collect telemetry.
- **Source availability**: the plugin source code is published on GitHub under the MIT license: <https://github.com/WesternGua/obsidian-zotero-citations>

---

## Quick Start

### 1. Insert a Citation

Search for `Insert citation` in the command palette, or click the citation icon in the title bar.

The plugin opens Zotero's native citation picker — search for items, add a page number or other locator, and confirm with the checkmark button.

A connection or Better BibTeX CAYW error is reported directly; there is no in-plugin fallback picker.

Inserted citations follow your current citation mode setting (footnote, endnote, or in-text).

> **Note**:
> - The plugin writes hidden metadata (`<!-- zotero:ITEMKEY:locator -->`) at the beginning of each note. Do not remove it manually, or the plugin will not be able to track the citation.
> - When you are ready to finalize, run `Unlink citations` (irreversible) to strip the hidden metadata while keeping the visible citation text.

![insert-citation-preview](assets/screenshots/insert-citation-preview.png)

### 2. Hover to Edit Locators

With Word-style footnote display enabled, hover over a superscript number to preview the full citation and edit the page/paragraph locator directly:

Locator values have a small border directly inside the citation preview. Click a value to edit its type and number or range in place. The type menu matches Zotero's locator names and ordering. Press Enter to save or Esc to cancel. References without a visible locator have a compact add/edit control. Hover a control to see its reference title. Each occurrence remains independent, and saving preserves the current cursor and reading position. Clear the number to remove only that reference's locator.

![en-hover-preview](assets/screenshots/en-hover-preview.png)

### 3. Switch Citation Style

Run `Document preferences` to open the preferences panel. The plugin dynamically reads all CSL styles installed in your Zotero and presents them in a searchable list. Pick a style, optionally switch between footnote/endnote/in-text mode, and apply the change to all citations in the current document at once:

![en-preferences](assets/screenshots/en-preferences.png)

### 4. Insert a Bibliography

Run `Insert bibliography` to generate a formatted reference list at the cursor position. On Word export, this managed bibliography is converted to a live Zotero bibliography field.

![en-insert-bibliography](assets/screenshots/en-insert-bibliography.png)

### 5. Export to Word

1. Make sure Zotero is running and Better BibTeX is enabled.
2. Run `Check whether Pandoc is available` to confirm Pandoc is working.
3. Run `Export to Word (.docx)`.

The plugin converts managed citations to Pandoc `[@citationKey]` syntax only in a system temporary copy; it never rewrites the source Markdown note. Footnote, endnote, and in-text citations in the resulting document contain live `ZOTERO_ITEM CSL_CITATION` fields. The DOCX stores the exact URI of the CSL style installed in Zotero, including custom styles hosted outside the official Zotero style domain, together with Zotero's locale and the appropriate note type. If Better BibTeX cannot resolve a style or citation key, export stops with an error instead of producing a document containing plain citation-key text. Open the document and click Zotero `Refresh` directly, or use `Document Preferences` to switch to another Zotero style.

Body text is SimSun 12pt, 1.5 line spacing, justified alignment, first-line indent, and headings in SimHei.

![en-export-to-word-preview](assets/screenshots/en-export-to-word-preview.png)

---

## Settings

### Refresh, comments and issue handling (0.3.0)

Write commentary after the generated citation. An invisible `<!-- /zotero-citation -->` boundary separates generated text from your commentary, which is preserved by refresh, locator edits and Word export. Existing citations without a boundary are migrated only when their generated prefix can be confirmed; uncertain citations remain unchanged.

Double-click a body footnote marker to jump to its definition. Double-click the definition number to return to the last originating occurrence, or the first reference if no origin is recorded.

Refresh updates normal citations and preserves entire groups with missing items or damaged metadata. It highlights the first issue and shows an upper-right panel with the updated count, issue list, previous/next controls and return to the previous location. Mode conversion retains grouped items and comments. A multi-paragraph footnote remains unchanged if the destination inline format cannot preserve its paragraphs, and the panel explains the limitation.

The Zotero port in settings defaults to `23119`. Word export uses that same setting; change it only when your Zotero/Better BibTeX endpoint uses a different port.

### Copy and paste with footnotes

In Source mode or Live Preview, select a passage containing complete `[^label]` markers and copy/paste normally (`Cmd+C` / `Cmd+V` on macOS). Referenced definitions are collected from the current editor, including unsaved edits. The body replaces the destination selection and new definitions are inserted at the end of the note, before a plugin-managed bibliography if present. Conflicting labels are renamed together with their references. An existing definition with exactly the same content can be reused, including a definition renamed by an earlier paste. Definitions already included in the selection are transferred once.

Ordinary footnotes, multiline definitions, repeated references, and grouped Zotero citations are supported. Original formatting, Zotero item keys, locators, and comments are preserved. Transfer does not contact Zotero or reformat citations. One undo reverses both body and definition insertion. The clipboard includes a custom payload and self-contained Markdown as a fallback when clipboard managers remove custom formats. Text pasted into other applications also includes referenced definitions.

The feature handles one continuous editor selection, independently of citation mode and Word-style display. Reading view, cut, multiple selections, code examples, partial definitions, and pasting inside definitions or code blocks retain native behavior. Inline `^[content]` notes already include their content and retain native copy behavior. Windows/Linux shortcuts are `Ctrl+C` / `Ctrl+V`; those platforms remain unvalidated.

![en-settings](assets/screenshots/en-settings.png)

![en-settings-2](assets/screenshots/en-settings-2.png)

### Main Settings

| Setting | Description |
|---------|-------------|
| Interface language | Chinese / English |
| Zotero port | Local Zotero/Better BibTeX port, default `23119`; also used for Word export |
| Default CSL style | Format used for newly inserted citations |
| Citation mode | Footnote / Endnote / In-text |
| Word-style footnote display | Superscript numbers + hover preview |
| Title bar buttons | Master toggle + 6 individual toggles (Insert citation, Toggle Word-style footnote display, Refresh all citations, Change citation style, Unlink citations, Export to Word), each controllable independently in settings |
| Pandoc path | Defaults to `pandoc`; accepts full paths |
| Extra Pandoc arguments | e.g. `--reference-doc=template.docx` |
| Fixed export directory | If unset, prompts for output location each time |
| Default export directory | Shown only when fixed export directory is enabled; if blank, uses the current note's folder |

---

## Command List

The plugin provides the following commands; you can search for them directly by name in the command palette:

| Command | Description |
|---------|-------------|
| Insert citation | Open the Zotero citation picker |
| Insert bibliography | Generate a reference list at the cursor |
| Refresh all citations | Re-fetch item data from Zotero and update |
| Document preferences | Switch CSL style and citation mode |
| Export to Word (.docx) | Convert to Word via Pandoc |
| Unlink citations | Remove plugin metadata (irreversible) |
| Toggle Word-style footnote display | Enable/disable superscript markers |
| Toggle title bar actions | Show/hide the title bar icons |
| Check whether Pandoc is available | Verify Pandoc installation |

---

## License

MIT
