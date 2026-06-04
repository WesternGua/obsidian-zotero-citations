# Zotero Citations v0.2.6

## Better BibTeX CAYW error reporting

- Fixed silent handling when the Better BibTeX CAYW endpoint fails or returns an invalid response.
- Insert citation now shows an explicit notice when CAYW returns a non-2xx status, non-JSON body, empty JSON body, or immediate empty response.
- The notice points users to check whether Better BibTeX is installed and compatible with their Zotero version.

---

**Full Changelog**: [CHANGELOG.md](./CHANGELOG.md)
