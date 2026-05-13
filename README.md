# Zotero Citations

> Manage Zotero citations in Obsidian with footnote/endnote modes, Word-style display, and one-click export to Word with formatted footnotes.

[简体中文](./README_zh.md)

---

## Highlights

- **Insert citations** — Invokes Zotero's native citation picker or an in-plugin search modal, with support for page/paragraph locators
- **Footnote / endnote / in-text** — Freely switch between footnote mode (`^[citation text]`), endnote mode (`[^1]` + endnote definitions), and in-text mode (plain-text author-year citations)
- **Word-style display** — Footnote markers render as superscript numbers in the editor; hover to preview the full citation and edit locators
- **Document preferences** — Dynamically reads all CSL styles installed in Zotero, with one-click style and mode switching
- **Bibliography** — Auto-generates a formatted reference list from all citations in the current document
- **Export to Word** — Converts Markdown to `.docx` via Pandoc; footnote/endnote modes preserve note structure, while in-text mode exports citations as plain paragraph text
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

The plugin will first try to open Zotero's native citation picker — search for items, add a page number or other locator, and confirm with the checkmark button.

Inserted citations follow your current citation mode setting (footnote, endnote, or in-text).

> **Note**:
> - The plugin writes hidden metadata (`<!-- zotero:ITEMKEY:locator -->`) at the beginning of each note. Do not remove it manually, or the plugin will not be able to track the citation.
> - When you are ready to finalize, run `Unlink citations` (irreversible) to strip the hidden metadata while keeping the visible citation text.

![insert-citation-preview](assets/screenshots/insert-citation-preview.png)

### 2. Hover to Edit Locators

With Word-style footnote display enabled, hover over a superscript number to preview the full citation and edit the page/paragraph locator directly:

![en-hover-preview](assets/screenshots/en-hover-preview.png)

### 3. Switch Citation Style

Run `Document preferences` to open the preferences panel. The plugin dynamically reads all CSL styles installed in your Zotero and presents them in a searchable list. Pick a style, optionally switch between footnote/endnote mode, and apply the change to all citations in the current document at once:

![en-preferences](assets/screenshots/en-preferences.png)

### 4. Insert a Bibliography

Run `Insert bibliography` to generate a formatted reference list at the cursor position. The bibliography is also preserved when exporting to Word.

![en-insert-bibliography](assets/screenshots/en-insert-bibliography.png)

### 5. Export to Word

1. Run `Check whether Pandoc is available` first to confirm Pandoc is working.
2. Run `Export to Word (.docx)`.

In footnote/endnote mode, the exported Word document keeps properly formatted notes. In in-text mode, citations are exported as plain author-year text in the main paragraph. Body text is SimSun 12pt, 1.5 line spacing, justified alignment, first-line indent, and headings in SimHei.

![en-export-to-word-preview](assets/screenshots/en-export-to-word-preview.png)

---

## Settings

![en-settings](assets/screenshots/en-settings.png)

![en-settings-2](assets/screenshots/en-settings-2.png)

### Main Settings

| Setting | Description |
|---------|-------------|
| Interface language | Chinese / English |
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
