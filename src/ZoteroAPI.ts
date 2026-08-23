/**
 * ZoteroAPI.ts – Communication with Zotero via Better BibTeX HTTP API
 * Improvement 2: Added getInstalledStyles() to dynamically read CSL styles from Zotero
 */
import { requestUrl } from "obsidian";
import * as nodeHttp from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { locateZoteroStylesDir, readZoteroIncludePaperArticleUrls, readZoteroLocale } from "./ZoteroEnvironment";

// ── Types ──────────────────────────────────────────────────────────────────
export interface ZoteroItem {
  key: string;
  itemType: string;
  title: string;
  creators: ZoteroCreator[];
  date?: string;
  publicationTitle?: string;
  bookTitle?: string;
  publisher?: string;
  place?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  edition?: string;
  DOI?: string;
  URL?: string;
  ISBN?: string;
  thesisType?: string;
  university?: string;
  conferenceName?: string;
  authority?: string;
  court?: string;
  docketNumber?: string;
  extra?: string;
  accessed?: string;
  /**
   * Raw CSL-JSON for this item, exactly as Zotero's standard CSL exporter
   * returned it. When present, the CSL engine consumes this directly so that
   * fields the legacy normalizer drops (accessed date, container-title
   * variants, etc.) are preserved for accurate formatting.
   */
  csl?: Record<string, unknown>;
}

export interface ZoteroCreator {
  firstName: string;
  lastName: string;
  name?: string;
  creatorType: string;
}

export interface CaywResult {
  item: ZoteroItem;
  locator?: string;
  locatorLabel?: string;
}

export interface InstalledStyle {
  id: string;
  title: string;
}

type JsonObject = Record<string, unknown>;

interface JsonRpcResponse {
  error?: JsonObject;
  result?: unknown;
}

interface SQLiteFieldRow {
  itemKey: string;
  itemType?: string;
  fieldName?: string;
  value?: string;
}

interface SQLiteCreatorRow {
  itemKey: string;
  creatorType?: string;
  firstName?: string;
  lastName?: string;
}

// ── Locator formatting ─────────────────────────────────────────────────────
const LOCATOR_PREFIX: Record<string, string> = {
  page: "p.",
  paragraph: "para.",
  section: "sec.",
  chapter: "ch.",
  figure: "fig.",
  table: "table",
  verse: "v.",
  line: "l.",
  note: "n.",
  column: "col.",
  issue: "no.",
  volume: "vol.",
};

export function formatLocator(locator?: string, label?: string): string {
  if (!locator) return "";
  const prefix = LOCATOR_PREFIX[label ?? "page"] ?? "";
  return prefix ? `${prefix} ${locator}` : locator;
}

// ── Error classes ──────────────────────────────────────────────────────────
export class ZoteroConnectionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ZoteroConnectionError";
  }
}

export class ZoteroPickerError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ZoteroPickerError";
  }
}

// ── Main API class ─────────────────────────────────────────────────────────
export class ZoteroAPI {
  port: number;
  baseUrl: string;

  constructor(port: number = 23119) {
    this.port = port;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async ping(): Promise<boolean> {
    try {
      const r = await requestUrl({ url: `${this.baseUrl}/connector/ping`, method: "GET", throw: false });
      if (r.status === 200) return true;
    } catch {
      // Fall back below.
    }

    // Obsidian's requestUrl can occasionally report ERR_EMPTY_RESPONSE for
    // Zotero's local connector even while Zotero is listening. Fall back to
    // Node's HTTP client so locator-editor locks reflect the real state.
    try {
      const body = await this.httpGet(`${this.baseUrl}/connector/ping`, 3000);
      return body.toLowerCase().includes("zotero");
    } catch {
      return false;
    }
  }

  async pingBBT(): Promise<boolean> {
    try {
      const text = await this.httpGet(`${this.baseUrl}/better-bibtex/cayw?probe=true`, 3000, true);
      return typeof text === "string";
    } catch {
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // IMPROVEMENT 2: Dynamic CSL style reading
  // ════════════════════════════════════════════════════════════════════════════

  locateZoteroStylesDir(): string | null {
    return locateZoteroStylesDir();
  }

  getZoteroLocale(): string {
    return readZoteroLocale();
  }

  getIncludePaperArticleUrls(): boolean {
    return readZoteroIncludePaperArticleUrls();
  }

  /**
   * Read all installed CSL styles from Zotero's styles directory.
   * Parses each .csl file's <title> and <id> tags.
   */
  getInstalledStyles(): InstalledStyle[] {
    const stylesDir = this.locateZoteroStylesDir();
    if (!stylesDir) return [];

    const results = new Map<string, InstalledStyle>();
    try {
      const files = fs.readdirSync(stylesDir).filter((f) => f.endsWith(".csl"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(stylesDir, file), "utf-8");
          // Extract <title> from CSL XML
          const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/);
          // Extract the ID from <id> or from filename
          const idMatch = content.match(/<id[^>]*>([^<]+)<\/id>/);
          let id = file.replace(/\.csl$/, "");
          if (idMatch) {
            // CSL IDs are typically URLs like http://www.zotero.org/styles/apa
            const urlId = idMatch[1];
            const lastSlash = urlId.lastIndexOf("/");
            if (lastSlash !== -1) id = urlId.slice(lastSlash + 1);
          }
          const title = titleMatch ? decodeXmlText(titleMatch[1].trim()) : id;
          if (id) results.set(id, { id, title });
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      return [];
    }

    // Sort by title
    return [...results.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CAYW picker
  // ════════════════════════════════════════════════════════════════════════════

  async openCAYW(onReturn?: () => void): Promise<CaywResult[]> {
    const startTime = Date.now();
    const rawText = await this.httpGet(
      `${this.baseUrl}/better-bibtex/cayw?format=json`,
      600000, // 10 min
      true, // non-2xx means the CAYW endpoint itself failed
    );
    const elapsed = Date.now() - startTime;
    try {
      onReturn?.();
    } catch {
      // ignore callback errors
    }

    // BBT returns an empty body when the user cancels the real picker. When the
    // endpoint returns immediately, however, Zotero never had a chance to show a
    // usable picker; surface that as an explicit plugin error instead of silently
    // treating it as a cancellation. This is the failure mode seen when CAYW is
    // broken by an incompatible Better BibTeX/Zotero combination.
    if (!rawText) {
      if (elapsed < 1500) {
        throw new ZoteroPickerError(
          "Better BibTeX CAYW returned an empty response before the picker could open. Better BibTeX may be disabled or incompatible with this Zotero version.",
        );
      }
      return [];
    }

    if (rawText === "[]") return [];
    if (rawText === "null" || rawText === "{}") {
      throw new ZoteroPickerError(
        "Better BibTeX CAYW returned an empty JSON response. Better BibTeX may be disabled or incompatible with this Zotero version.",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Non-JSON response means BBT returned something unexpected, for example
      // its plain-text "CAYW failed" error body. Do not swallow it silently.
      throw new ZoteroPickerError(`Unexpected response from Better BibTeX CAYW: ${snippet(rawText)}`);
    }

    const rawItems = this.extractArray(parsed);
    if (!rawItems.length) return [];

    const result: CaywResult[] = [];
    for (const raw of rawItems) {
      const cayw = this.parseCaywItem(raw);
      if (!cayw) continue;
      if (!cayw.item.creators.length) {
        const key = cayw.item.key;
        const full = key ? await this.fetchFullItem(key, cayw.item.title) : null;
        if (full) {
          cayw.item = { ...full, key: cayw.item.key };
        }
      }
      result.push(cayw);
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Search
  // ════════════════════════════════════════════════════════════════════════════

  async searchItems(query: string): Promise<ZoteroItem[]> {
    if (!query.trim()) return [];
    try {
      const d = await this.bbtJsonRpc("item.search", [query], 1);
      if (d.error) throw new Error(toStr(d.error.message) || "Zotero JSON-RPC error");
      const result = Array.isArray(d.result) ? d.result : [];
      return result.map((item) => this.normalizeAny(item)).filter((item) => item.title.length > 0);
    } catch (err) {
      throw new ZoteroConnectionError(String(err));
    }
  }

  async getCitationKeys(itemKeys: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!itemKeys.length) return map;
    try {
      const d = await this.bbtJsonRpc("item.citationkey", [itemKeys], 2);
      if (d.error || !isRecord(d.result)) return map;
      for (const [itemKey, citeKey] of Object.entries(d.result)) {
        if (typeof citeKey === "string" && citeKey.trim()) map.set(itemKey, citeKey);
      }
    } catch {
      // ignore lookup failures and return partial results
    }
    return map;
  }

  async getItemsByKeys(keys: string[], libraryID: number = 1): Promise<Map<string, ZoteroItem>> {
    const map = await this.getItemsByKeysRemote(keys, libraryID);
    const stillMissing = keys.filter((k) => !map.has(k));
    if (!stillMissing.length) return map;

    // Fallback: local DB
    try {
      const dbItems = await this.getItemsFromLocalDB(stillMissing);
      for (const [k, v] of dbItems) map.set(k, v);
    } catch {
      // ignore lookup failures and return partial results
    }

    return map;
  }

  async getItemsByKeysRemote(keys: string[], libraryID: number = 1): Promise<Map<string, ZoteroItem>> {
    const map = new Map<string, ZoteroItem>();
    if (!keys.length) return map;

    // Try via export
    try {
      const d = await this.bbtJsonRpc("item.export", [keys, "f4b52ab0-f878-4556-85a0-c7aeedd09dfc", libraryID], 3);
      if (!d.error) {
        const items = parseJsonArray(d.result);
        for (const it of items) {
          const item = this.normalizeAny(it);
          if (item.key && keys.includes(item.key)) map.set(item.key, item);
        }
      }
    } catch {
      // ignore lookup failures and return partial results
    }

    // Fallback: via citation keys
    const missing = keys.filter((k) => !map.has(k));
    if (!missing.length) return map;
    try {
      const citeKeyMap = await this.getCitationKeys(missing);
      const citeKeys: string[] = [];
      const reverse = new Map<string, string>();
      for (const itemKey of missing) {
        const citeKey = citeKeyMap.get(itemKey);
        if (!citeKey) continue;
        citeKeys.push(citeKey);
        reverse.set(citeKey, itemKey);
      }
      if (citeKeys.length) {
        const d = await this.bbtJsonRpc("item.export", [citeKeys, "f4b52ab0-f878-4556-85a0-c7aeedd09dfc", libraryID], 4);
        if (!d.error) {
          const items = parseJsonArray(d.result);
          for (const it of items) {
            const item = this.normalizeAny(it);
            const found = item.key ? reverse.get(item.key) : undefined;
            if (found) map.set(found, { ...item, key: found });
          }
        }
      }
    } catch {
      // ignore lookup failures and return partial results
    }

    return map;
  }

  async getItemsFromLocalDB(keys: string[]): Promise<Map<string, ZoteroItem>> {
    const map = new Map<string, ZoteroItem>();
    if (!keys.length) return map;

    const sqlite = this.locateZoteroSQLite();
    if (!sqlite) return map;

    const tmpDir = path.join(os.tmpdir(), "zotero-citations-db");
    const tmpDb = path.join(tmpDir, "zotero.sqlite");
    const tmpJournal = path.join(tmpDir, "zotero.sqlite-journal");

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.copyFileSync(sqlite, tmpDb);
      const journal = `${sqlite}-journal`;
      if (fs.existsSync(journal)) fs.copyFileSync(journal, tmpJournal);
    } catch {
      return map;
    }

    const quoted = keys.map((k) => `'${String(k).replace(/'/g, "''")}'`).join(", ");
    const fieldSql = `SELECT i.key as itemKey, it.typeName as itemType, f.fieldName as fieldName, v.value as value
FROM items i
JOIN itemTypesCombined it ON it.itemTypeID=i.itemTypeID
LEFT JOIN itemData d ON d.itemID=i.itemID
LEFT JOIN fieldsCombined f ON f.fieldID=d.fieldID
LEFT JOIN itemDataValues v ON v.valueID=d.valueID
WHERE i.key IN (${quoted})
ORDER BY i.key, f.fieldName;`;

    const creatorSql = `SELECT i.key as itemKey, ct.creatorType as creatorType, c.firstName as firstName, c.lastName as lastName, ic.orderIndex as orderIndex
FROM items i
JOIN itemCreators ic ON ic.itemID=i.itemID
JOIN creators c ON c.creatorID=ic.creatorID
JOIN creatorTypes ct ON ct.creatorTypeID=ic.creatorTypeID
WHERE i.key IN (${quoted})
ORDER BY i.key, ic.orderIndex;`;

    try {
      const { execAsync, buildEnv } = await import("./ExportManager");
      const { stdout: fieldsRaw } = await execAsync(`sqlite3 -json ${this.q(tmpDb)} ${this.q(fieldSql)}`, { timeout: 10000, env: buildEnv() });
      const { stdout: creatorsRaw } = await execAsync(`sqlite3 -json ${this.q(tmpDb)} ${this.q(creatorSql)}`, { timeout: 10000, env: buildEnv() });
      const fieldRows = parseSQLiteFieldRows(fieldsRaw);
      const creatorRows = parseSQLiteCreatorRows(creatorsRaw);

      const grouped = new Map<string, { key: string; creators: ZoteroCreator[]; fields: Record<string, string>; itemType?: string }>();
      for (const row of fieldRows) {
        if (!row.itemKey) continue;
        const cur: { key: string; creators: ZoteroCreator[]; fields: Record<string, string>; itemType?: string } =
          grouped.get(row.itemKey) || { key: row.itemKey, creators: [], fields: {}, itemType: row.itemType };
        if (row.itemType && !cur.itemType) cur.itemType = row.itemType;
        if (row.fieldName && row.value != null) cur.fields[row.fieldName] = String(row.value);
        grouped.set(row.itemKey, cur);
      }
      for (const row of creatorRows) {
        if (!row.itemKey) continue;
        const cur: { key: string; creators: ZoteroCreator[]; fields: Record<string, string>; itemType?: string } =
          grouped.get(row.itemKey) || { key: row.itemKey, creators: [], fields: {}, itemType: undefined };
        cur.creators.push({
          firstName: row.firstName || "",
          lastName: row.lastName || "",
          creatorType: row.creatorType || "author",
        });
        grouped.set(row.itemKey, cur);
      }

      for (const [key, g] of grouped) {
        const f = g.fields;
        const item: ZoteroItem = {
          key,
          itemType: g.itemType === "case" ? "legal_case" : (g.itemType || ""),
          title: f.title || f.caseName || "",
          creators: g.creators,
          date: f.date || f.dateDecided || undefined,
          accessed: f.accessDate || undefined,
          publicationTitle: f.publicationTitle || undefined,
          bookTitle: f.bookTitle || undefined,
          publisher: f.publisher || undefined,
          place: f.place || undefined,
          volume: f.volume || undefined,
          issue: f.issue || undefined,
          pages: f.pages || undefined,
          edition: f.edition || undefined,
          DOI: f.DOI || undefined,
          URL: f.url || undefined,
          ISBN: f.ISBN || undefined,
          thesisType: f.thesisType || undefined,
          university: f.university || undefined,
          conferenceName: f.conferenceName || undefined,
          authority: f.authority || f.court || undefined,
          court: f.court || f.authority || undefined,
          docketNumber: f.docketNumber || f.number || undefined,
          extra: f.extra || undefined,
        };
        if (item.title) map.set(key, item);
      }
    } catch {
      // ignore lookup failures and return partial results
    }
    return map;
  }

  locateZoteroSQLite(): string | null {
    const home = os.homedir();
    const candidates = [
      path.join(home, "Zotero", "zotero.sqlite"),
      path.join(home, "Library", "Application Support", "Zotero", "zotero.sqlite"),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // ignore lookup failures and return partial results
      }
    }
    return null;
  }

  q(s: string): string {
    return `"${String(s).replace(/(["\\$`\\\\])/g, "\\\\$1")}"`;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchFullItem(key: string, title?: string): Promise<ZoteroItem | null> {
    try {
      const byKey = await this.getItemsByKeys([key]);
      const item = byKey.get(key);
      if (item?.title) return item;
    } catch {
      // ignore lookup failures and return partial results
    }
    try {
      const byDb = await this.getItemsFromLocalDB([key]);
      const item = byDb.get(key);
      if (item?.title) return item;
    } catch {
      // ignore lookup failures and return partial results
    }
    try {
      const results = await this.searchItems(key);
      const match = results.find((r) => r.key === key) ?? (results.length ? results[0] : null);
      if (match?.title) return match;
    } catch {
      // ignore lookup failures and return partial results
    }
    if (title) {
      try {
        const results = await this.searchItems(title);
        const match = results.find((r) => r.title.toLowerCase() === title.toLowerCase()) ?? results[0];
        if (match?.title) return match;
      } catch {
        // ignore lookup failures and return partial results
      }
    }
    return null;
  }

  private httpGet(url: string, timeoutMs: number = 30000, expectStatus2xx = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = nodeHttp.get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8").trim();
          const status = res.statusCode ?? 0;
          if (expectStatus2xx && (status < 200 || status >= 300)) {
            reject(new ZoteroPickerError(`Better BibTeX CAYW HTTP ${status}: ${snippet(text)}`));
            return;
          }
          resolve(text);
        });
        res.on("error", (e: Error) => reject(new ZoteroConnectionError(e.message)));
      });
      req.on("error", (e: Error) => reject(new ZoteroConnectionError(e.message)));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new ZoteroConnectionError("HTTP timeout"));
      });
    });
  }

  private httpPostJson(url: string, data: unknown, timeoutMs: number = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(data);
      const req = nodeHttp.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8").trim();
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(new ZoteroConnectionError(`HTTP ${status}: ${text}`));
              return;
            }
            try {
              resolve(text ? JSON.parse(text) : null);
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
          res.on("error", (e: Error) => reject(new ZoteroConnectionError(e.message)));
        },
      );
      req.on("error", (e: Error) => reject(new ZoteroConnectionError(e.message)));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new ZoteroConnectionError("HTTP timeout"));
      });
      req.write(body);
      req.end();
    });
  }

  private async bbtJsonRpc(method: string, params: unknown[], id: number): Promise<JsonRpcResponse> {
    const payload = { jsonrpc: "2.0", method, params, id };
    try {
      const r = await requestUrl({
        url: `${this.baseUrl}/better-bibtex/json-rpc`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        throw: false,
      });
      if (r.status === 200) return asJsonRpcResponse(r.json);
    } catch {
      // Fall back below.
    }

    // Same rationale as ping(): requestUrl may fail against Zotero's local
    // server while Node HTTP succeeds. Use this fallback for live Zotero reads.
    return asJsonRpcResponse(await this.httpPostJson(`${this.baseUrl}/better-bibtex/json-rpc`, payload));
  }

  private extractArray(data: unknown): JsonObject[] {
    if (Array.isArray(data)) return data.filter(isRecord);
    if (isRecord(data)) {
      for (const key of ["items", "citationItems", "citations"]) {
        const value = data[key];
        if (Array.isArray(value)) return value.filter(isRecord);
      }
    }
    return [];
  }

  private parseCaywItem(raw: JsonObject): CaywResult | null {
    const locator = raw.locator ? toStr(raw.locator) : undefined;
    const locatorLabel = raw.label ? toStr(raw.label) : "page";
    const itemSrc = isRecord(raw.itemData) ? raw.itemData : isRecord(raw.item) ? raw.item : raw;
    const preferParentKey = itemSrc.itemType === "attachment" && itemSrc.parentItem ? toStr(itemSrc.parentItem) : "";
    let key = "";
    if (preferParentKey) key = preferParentKey;
    for (const f of ["itemKey", "key", "citationKey", "citekey"]) {
      if (key) break;
      const v = itemSrc[f] ?? raw[f];
      if (v && toStr(v).length >= 2) { key = toStr(v); break; }
    }
    if (!key) {
      for (const f of ["id"]) {
        const v = itemSrc[f] ?? raw[f];
        if (v && toStr(v).length >= 2) { key = toStr(v); break; }
      }
    }
    const item = this.normalizeAny(itemSrc);
    if (key) item.key = key;
    if (!item.key) return null;
    return { item, locator, locatorLabel };
  }

  /**
   * Unified normalizer that handles BOTH native Zotero AND CSL-JSON formats.
   */
  normalizeAny(r: unknown): ZoteroItem {
    const record = isRecord(r) ? r : {};
    let key = "";
    for (const f of ["itemKey", "key", "citationKey"]) {
      if (record[f]) { key = toStr(record[f]); break; }
    }
    if (!key && typeof record.id === "string") {
      const m = record.id.match(/\/items\/([A-Z0-9]{8})(?:$|[/?#])/i);
      if (m) key = m[1];
    }
    for (const f of ["citation-key", "citekey", "id"]) {
      if (key) break;
      if (record[f]) { key = toStr(record[f]); break; }
    }

    const cslTypeMap: Record<string, string> = {
      "article-journal": "journalArticle",
      "article-magazine": "magazineArticle",
      "article-newspaper": "newspaperArticle",
      "book": "book",
      "chapter": "bookSection",
      "thesis": "thesis",
      "paper-conference": "conferencePaper",
      "webpage": "webpage",
      "report": "report",
      "legal_case": "legal_case",
    };
    const rawType = toStr(record.itemType ?? record.type);
    const itemType = cslTypeMap[rawType] ?? rawType;
    const title = toStr(record.title ?? record.caseName);

    const creators: ZoteroCreator[] = [];
    if (Array.isArray(record.creators) && record.creators.length > 0) {
      for (const c of record.creators.filter(isRecord)) {
        creators.push({
          firstName: toStr(c.firstName ?? c.given),
          lastName: toStr(c.lastName ?? c.family),
          name: (c.name ?? c.literal) ? toStr(c.name ?? c.literal) : undefined,
          creatorType: toStr(c.creatorType) || "author",
        });
      }
    } else {
      for (const [field, ctype] of [["author", "author"], ["editor", "editor"]] as const) {
        const rawCreators = record[field];
        if (Array.isArray(rawCreators)) {
          for (const a of rawCreators.filter(isRecord)) {
            creators.push({
              firstName: toStr(a.given ?? a.firstName),
              lastName: toStr(a.family ?? a.lastName),
              name: (a.literal ?? a.name) ? toStr(a.literal ?? a.name) : undefined,
              creatorType: ctype,
            });
          }
        }
      }
    }

    let date: string | undefined;
    if (record.date) {
      const m = toStr(record.date).match(/\b(\d{4})\b/);
      date = m ? m[1] : toStr(record.date);
    } else {
      const issued = isRecord(record.issued) ? record.issued : undefined;
      const dateParts = issued?.["date-parts"];
      const firstDatePart = isUnknownArray(dateParts) ? dateParts[0] : undefined;
      const y = isUnknownArray(firstDatePart) && firstDatePart.length > 0 ? firstDatePart[0] : undefined;
      if (typeof y === "number" || typeof y === "string") date = String(y);
    }

    // Accessed date (for webpages etc.). Native Zotero uses `accessDate`
    // (a string); CSL-JSON uses `accessed.date-parts`. Keep both shapes.
    let accessed: string | undefined;
    if (record.accessDate) {
      accessed = toStr(record.accessDate);
    } else {
      const acc = isRecord(record.accessed) ? record.accessed : undefined;
      const accParts = acc?.["date-parts"];
      const firstAccPart = isUnknownArray(accParts) ? accParts[0] : undefined;
      if (isUnknownArray(firstAccPart) && firstAccPart.length > 0) {
        accessed = firstAccPart.map((p) => String(p)).join("-");
      }
    }

    // Preserve the raw CSL-JSON when the source looks like CSL (has a `type`
    // field or CSL-style `issued`/`container-title`). This lets the real CSL
    // engine format the item faithfully instead of the fallback templates.
    let csl: Record<string, unknown> | undefined;
    if (record.type || record.issued || record["container-title"] || record.accessed) {
      csl = { ...record };
    }

    const publicationTitle = toStr(record.publicationTitle ?? record["container-title"] ?? record.journalAbbreviation) || undefined;
    const authority = toStr(record.authority ?? record.court) || undefined;

    return {
      key,
      itemType,
      title,
      creators,
      date,
      accessed,
      csl,
      publicationTitle,
      bookTitle: toStr(record.bookTitle ?? record["collection-title"]) || undefined,
      publisher: toStr(record.publisher) || undefined,
      place: toStr(record.place ?? record["publisher-place"]) || undefined,
      volume: toStr(record.volume) || undefined,
      issue: toStr(record.issue) || undefined,
      pages: toStr(record.pages ?? record.page) || undefined,
      edition: toStr(record.edition) || undefined,
      DOI: toStr(record.DOI) || undefined,
      URL: toStr(record.url ?? record.URL) || undefined,
      ISBN: toStr(record.ISBN) || undefined,
      thesisType: toStr(record.thesisType) || undefined,
      university: toStr(record.university ?? record.school) || undefined,
      conferenceName: toStr(record.conferenceName ?? record["event-title"]) || undefined,
      authority,
      court: authority,
      docketNumber: (record.docketNumber ?? record.number) ? toStr(record.docketNumber ?? record.number) : undefined,
      extra: (record.extra ?? record.note) ? toStr(record.extra ?? record.note) : undefined,
    };
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function asJsonRpcResponse(value: unknown): JsonRpcResponse {
  if (!isRecord(value)) return {};
  return {
    error: isRecord(value.error) ? value.error : undefined,
    result: value.result,
  };
}

function snippet(text: string, max = 200): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "(empty response)";
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function decodeXmlText(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_match, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, value: string) => String.fromCodePoint(parseInt(value, 16)));
}

function parseJsonArray(input: unknown): unknown[] {
  if (typeof input !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSQLiteFieldRows(raw: string): SQLiteFieldRow[] {
  const rows = parseJsonArray(raw || "[]");
  const out: SQLiteFieldRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const itemKey = toStr(row.itemKey);
    if (!itemKey) continue;
    out.push({
      itemKey,
      itemType: toStr(row.itemType) || undefined,
      fieldName: toStr(row.fieldName) || undefined,
      value: row.value == null ? undefined : toStr(row.value),
    });
  }
  return out;
}

function parseSQLiteCreatorRows(raw: string): SQLiteCreatorRow[] {
  const rows = parseJsonArray(raw || "[]");
  const out: SQLiteCreatorRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const itemKey = toStr(row.itemKey);
    if (!itemKey) continue;
    out.push({
      itemKey,
      creatorType: toStr(row.creatorType) || undefined,
      firstName: toStr(row.firstName) || undefined,
      lastName: toStr(row.lastName) || undefined,
    });
  }
  return out;
}

/** Safely convert an unknown value to string, avoiding '[object Object]'. */
function toStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
