# Third-Party Notices

## citeproc-js

This plugin bundles `citeproc` / citeproc-js, copyright © 2009–2019 Frank Bennett.
It is distributed under the CPAL 1.0 or, at the recipient's option, the AGPL 3.0.
Source and license information: https://github.com/Juris-M/citeproc-js

## CSL locale data

This plugin bundles CSL locale data through `@manuscripts/csl-locales`. The data
is derived from the Citation Style Language Locales project and is licensed
under Creative Commons Attribution-ShareAlike 3.0 Unported.

CSL project: https://citationstyles.org/
Locale source: https://github.com/citation-style-language/locales

The translator/contributor metadata contained in the locale data is preserved.

## Better BibTeX Pandoc live-citations filter

This plugin includes a vendored copy of the Better BibTeX Pandoc filter that
converts Pandoc citation nodes to live Zotero fields in Word/LibreOffice.

- Copyright © 2020 Emiliano Heyns
- License: MIT
- Source: https://github.com/retorquere/zotero-better-bibtex
- Vendored upstream commit: `73dd6799831d1c11f0186bd44bbb26c43b95e521`
- Upstream filter revision: `199d652`

The upstream online update check was removed from the vendored copy so Word
exports remain local-only. The filter's MIT license notice is retained in the
vendored source.

## Test-only CSL styles

The IEEE and APA CSL files under `tests/fixtures/styles/` are included only as
automated test fixtures. They come from the Citation Style Language styles
repository and are distributed under CC BY-SA 3.0.

Style source: https://github.com/citation-style-language/styles
