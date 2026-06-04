# Zotero Citations v0.2.5

## Locator editing reliability and safety

- Fixed locator edits sometimes failing with “Could not find the active editor”.
- Blocked locator edits while Zotero is offline to avoid regenerating citations from stale cached metadata.
- Added live reconnect checks so the locator editor unlocks after Zotero comes back online.
- Added Node HTTP fallbacks for Zotero ping and Better BibTeX JSON-RPC reads when Obsidian `requestUrl` misreports the local connector.
- Fixed remote item fetching during locator saves so it no longer loses plugin context and incorrectly reports missing Zotero items.

---

**Full Changelog**: [CHANGELOG.md](./CHANGELOG.md)
