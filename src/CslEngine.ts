/**
 * CSL formatting backed exclusively by the styles installed in Zotero.
 *
 * The plugin does not ship citation styles and does not approximate a missing
 * style. It reads Zotero's .csl files, resolves dependent styles, uses Zotero's
 * locale preference, and returns null when Zotero no longer has the style.
 */
import * as fs from "fs";
import * as path from "path";
import type { ZoteroItem } from "./ZoteroAPI";
import { locateZoteroStylesDir, readZoteroIncludePaperArticleUrls, readZoteroLocale } from "./ZoteroEnvironment";

const CSL: any = require("citeproc");
const CSL_LOCALES: Record<string, unknown> = require("@manuscripts/csl-locales");

const DEFAULT_LOCALE = "en-US";

const ZOTERO_TO_CSL_TYPE: Record<string, string> = {
  journalArticle: "article-journal",
  magazineArticle: "article-magazine",
  newspaperArticle: "article-newspaper",
  book: "book",
  bookSection: "chapter",
  thesis: "thesis",
  conferencePaper: "paper-conference",
  webpage: "webpage",
  report: "report",
  legal_case: "legal_case",
};

export interface CslCitationInput {
  item: ZoteroItem;
  page?: string;
}

export interface FormattedBibliographyEntry {
  key: string;
  text: string;
}

interface StyleLookup {
  xml: string;
  sourceXml: string;
  locale: string;
  fingerprint: string;
}

interface EngineLookup {
  engine: any;
  style: StyleLookup;
}

export class CslEngine {
  private static engineCache = new Map<string, any>();
  private static itemStore: Record<string, unknown> = {};
  private static configuredStylesDir: string | null = null;
  private static configuredLocale = DEFAULT_LOCALE;
  private static includePaperArticleUrls = false;

  static refreshConfiguration(stylesDir?: string | null, locale?: string, includePaperArticleUrls?: boolean): void {
    CslEngine.configuredStylesDir = stylesDir ?? locateZoteroStylesDir();
    CslEngine.configuredLocale = CslEngine.resolveLocale(locale || readZoteroLocale());
    CslEngine.includePaperArticleUrls = includePaperArticleUrls ?? readZoteroIncludePaperArticleUrls();
    CslEngine.engineCache.clear();
  }

  static getLocale(): string {
    return CslEngine.configuredLocale;
  }

  static canFormat(styleId: string): boolean {
    if (!styleId) return false;
    try {
      return CslEngine.getEngine(styleId) !== null;
    } catch {
      return false;
    }
  }

  static formatCitationText(item: ZoteroItem, styleId: string, page?: string): string | null {
    return CslEngine.formatCitationCluster([{ item, page }], styleId);
  }

  static formatCitationCluster(entries: CslCitationInput[], styleId: string): string | null {
    try {
      if (!entries.length) return "";
      const lookup = CslEngine.getEngine(styleId);
      if (!lookup) return null;

      const store: Record<string, unknown> = {};
      const citationItems: Record<string, unknown>[] = [];
      for (const entry of entries) {
        const csl = CslEngine.toCsl(entry.item);
        const id = String(csl.id);
        store[id] = csl;
        const locator = CslEngine.parseLocator(entry.page);
        citationItems.push(locator
          ? { id, locator: locator.value, label: locator.label }
          : { id });
      }

      CslEngine.itemStore = store;
      lookup.engine.updateItems(Object.keys(store));
      const citation = {
        citationItems,
        properties: { noteIndex: 1 },
      };
      const out = lookup.engine.previewCitationCluster(citation, [], [], "html");
      return CslEngine.htmlToMarkdown(out) || null;
    } catch {
      return null;
    }
  }

  static formatNoteText(item: ZoteroItem, styleId: string, page?: string): string | null {
    return CslEngine.formatNoteCluster([{ item, page }], styleId);
  }

  static formatNoteCluster(entries: CslCitationInput[], styleId: string): string | null {
    if (!entries.length) return "";
    if (!CslEngine.isNumericStyle(styleId)) {
      return CslEngine.formatCitationCluster(entries, styleId);
    }

    const bibliography = CslEngine.formatBibliography(entries.map((entry) => entry.item), styleId);
    if (!bibliography || bibliography.size !== new Set(entries.map((entry) => entry.item.key)).size) {
      return null;
    }

    const parts: string[] = [];
    for (const entry of entries) {
      const formatted = bibliography.get(entry.item.key);
      if (!formatted) return null;
      let text = CslEngine.stripNumericBibliographyLabel(formatted);
      if (entry.page) {
        const citation = CslEngine.formatCitationText(entry.item, styleId, entry.page);
        const locator = citation ? CslEngine.extractNumericLocator(citation) : null;
        if (locator) text = CslEngine.appendLocator(text, locator);
      }
      parts.push(text);
    }
    return parts.join("; ");
  }

  static formatBibliography(items: ZoteroItem[], styleId: string): Map<string, string> | null {
    const ordered = CslEngine.formatBibliographyOrdered(items, styleId);
    if (!ordered) return null;
    return new Map(ordered.map((entry) => [entry.key, entry.text]));
  }

  static formatBibliographyOrdered(items: ZoteroItem[], styleId: string): FormattedBibliographyEntry[] | null {
    try {
      if (!items.length) return [];
      const lookup = CslEngine.getEngine(styleId);
      if (!lookup) return null;

      const store: Record<string, unknown> = {};
      const ids: string[] = [];
      for (const item of items) {
        const csl = CslEngine.toCsl(item);
        const id = String(csl.id);
        store[id] = csl;
        ids.push(id);
      }

      CslEngine.itemStore = store;
      lookup.engine.updateItems(ids);
      const result = lookup.engine.makeBibliography();
      if (!result || !Array.isArray(result) || !result[1]) return null;

      const meta = result[0] as { entry_ids?: string[][] };
      const rendered = result[1] as string[];
      const order = meta?.entry_ids ?? [];
      const entries: FormattedBibliographyEntry[] = [];
      for (let index = 0; index < rendered.length; index++) {
        const key = order[index]?.[0];
        if (!key) continue;
        const text = CslEngine.htmlToMarkdown(rendered[index]);
        if (text) entries.push({ key, text });
      }
      return entries;
    } catch {
      return null;
    }
  }

  static toCsl(item: ZoteroItem): Record<string, unknown> {
    const raw = item.csl && typeof item.csl === "object" ? { ...item.csl } : null;
    const base = raw ?? CslEngine.fromZoteroItem(item);
    base.id = item.key;
    const paperArticleTypes = new Set(["article-journal", "article-magazine", "article-newspaper"]);
    if (!CslEngine.includePaperArticleUrls && paperArticleTypes.has(String(base.type ?? ""))) {
      delete base.URL;
      delete base.url;
    }
    return base;
  }

  static htmlToMarkdown(html: string): string {
    if (!html) return "";
    let text = html;
    text = text.replace(/<br\s*\/?\s*>/gi, " ");
    text = text.replace(/<\/div>\s*<div[^>]*>/gi, " ");
    text = text.replace(/<i>([\s\S]*?)<\/i>/gi, (_match, inner) => `*${inner}*`);
    text = text.replace(/<em>([\s\S]*?)<\/em>/gi, (_match, inner) => `*${inner}*`);
    text = text.replace(/<b>([\s\S]*?)<\/b>/gi, (_match, inner) => `**${inner}**`);
    text = text.replace(/<strong>([\s\S]*?)<\/strong>/gi, (_match, inner) => `**${inner}**`);
    text = text.replace(/<sup>([\s\S]*?)<\/sup>/gi, "$1");
    text = text.replace(/<sub>([\s\S]*?)<\/sub>/gi, "$1");
    text = text.replace(/<[^>]+>/g, "");
    text = CslEngine.decodeEntities(text);
    return text.replace(/[ \t]*\n[ \t]*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  }

  private static getEngine(styleId: string): EngineLookup | null {
    const style = CslEngine.loadStyle(styleId);
    if (!style) return null;
    const cacheKey = `${styleId}\0${style.locale}\0${style.fingerprint}`;
    let engine = CslEngine.engineCache.get(cacheKey);
    if (!engine) {
      const sys = {
        retrieveLocale: (requested: string): unknown => CslEngine.getLocaleData(requested || style.locale),
        retrieveItem: (id: string): unknown => CslEngine.itemStore[id],
      };
      engine = new CSL.Engine(sys, style.xml, style.locale);
      CslEngine.engineCache.set(cacheKey, engine);
      if (CslEngine.engineCache.size > 12) {
        const oldest = CslEngine.engineCache.keys().next().value as string | undefined;
        if (oldest) CslEngine.engineCache.delete(oldest);
      }
    }
    return { engine, style };
  }

  private static loadStyle(styleId: string): StyleLookup | null {
    const stylePath = CslEngine.findStyleFile(styleId);
    if (!stylePath) return null;
    return CslEngine.resolveStyle(stylePath, new Set());
  }

  private static resolveStyle(stylePath: string, visited: Set<string>): StyleLookup | null {
    const canonical = path.resolve(stylePath);
    if (visited.has(canonical)) return null;
    visited.add(canonical);

    let sourceXml: string;
    let stat: fs.Stats;
    try {
      sourceXml = fs.readFileSync(canonical, "utf-8");
      stat = fs.statSync(canonical);
    } catch {
      return null;
    }

    const ownLocale = CslEngine.extractRootAttribute(sourceXml, "default-locale");
    const parentId = CslEngine.extractIndependentParentId(sourceXml);
    if (!parentId) {
      return {
        xml: sourceXml,
        sourceXml,
        locale: CslEngine.resolveLocale(ownLocale || CslEngine.configuredLocale),
        fingerprint: `${canonical}:${stat.mtimeMs}:${stat.size}`,
      };
    }

    const parentPath = CslEngine.findStyleFile(parentId);
    if (!parentPath) return null;
    const parent = CslEngine.resolveStyle(parentPath, visited);
    if (!parent) return null;
    return {
      xml: parent.xml,
      sourceXml,
      locale: CslEngine.resolveLocale(ownLocale || parent.locale || CslEngine.configuredLocale),
      fingerprint: `${canonical}:${stat.mtimeMs}:${stat.size}>${parent.fingerprint}`,
    };
  }

  private static findStyleFile(styleId: string): string | null {
    const stylesDir = CslEngine.configuredStylesDir ?? locateZoteroStylesDir();
    if (!stylesDir || !styleId) return null;
    CslEngine.configuredStylesDir = stylesDir;

    if (path.basename(styleId) === styleId) {
      const direct = path.join(stylesDir, `${styleId}.csl`);
      try {
        if (fs.statSync(direct).isFile()) return direct;
      } catch {
        // Scan IDs below because filenames and CSL IDs do not always match.
      }
    }

    try {
      for (const file of fs.readdirSync(stylesDir)) {
        if (!file.toLowerCase().endsWith(".csl")) continue;
        const candidate = path.join(stylesDir, file);
        try {
          const xml = fs.readFileSync(candidate, "utf-8");
          if (CslEngine.extractStyleId(xml) === styleId) return candidate;
        } catch {
          // Skip unreadable styles.
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private static extractStyleId(xml: string): string {
    const match = xml.match(/<id[^>]*>([^<]+)<\/id>/i);
    const value = match?.[1]?.trim() ?? "";
    return value.slice(value.lastIndexOf("/") + 1);
  }

  private static extractRootAttribute(xml: string, name: string): string {
    const root = xml.match(/<style\b[^>]*>/i)?.[0];
    if (!root) return "";
    return CslEngine.extractAttribute(root, name);
  }

  private static extractIndependentParentId(xml: string): string {
    const links = xml.match(/<link\b[^>]*>/gi) ?? [];
    const parent = links.find((link) => CslEngine.extractAttribute(link, "rel") === "independent-parent");
    if (!parent) return "";
    const href = CslEngine.extractAttribute(parent, "href");
    return href.slice(href.lastIndexOf("/") + 1);
  }

  private static extractAttribute(tag: string, name: string): string {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i"));
    return match?.[1]?.trim() ?? "";
  }

  private static isNumericStyle(styleId: string): boolean {
    const style = CslEngine.loadStyle(styleId);
    return !!style && /<category\b[^>]*\bcitation-format\s*=\s*["']numeric["'][^>]*\/?\s*>/i.test(style.xml);
  }

  private static getLocaleData(requested: string): unknown {
    const resolved = CslEngine.resolveLocale(requested);
    return CSL_LOCALES[resolved] ?? CSL_LOCALES[DEFAULT_LOCALE];
  }

  private static resolveLocale(requested: string): string {
    const normalized = (requested || DEFAULT_LOCALE).replace(/_/g, "-");
    const exact = Object.keys(CSL_LOCALES).find((locale) => locale.toLowerCase() === normalized.toLowerCase());
    if (exact) return exact;
    const language = normalized.split("-")[0].toLowerCase();
    const languageMatch = Object.keys(CSL_LOCALES).find((locale) => locale.toLowerCase() === language)
      ?? Object.keys(CSL_LOCALES).find((locale) => locale.toLowerCase().startsWith(`${language}-`));
    return languageMatch ?? DEFAULT_LOCALE;
  }

  private static parseLocator(page?: string): { label: string; value: string } | null {
    const raw = page?.trim();
    if (!raw) return null;
    const prefixes: Array<[RegExp, string]> = [
      [/^p(?:p)?\.\s*/i, "page"],
      [/^para\.\s*/i, "paragraph"],
      [/^sec\.\s*/i, "section"],
      [/^ch\.\s*/i, "chapter"],
      [/^fig\.\s*/i, "figure"],
      [/^table\s*/i, "table"],
      [/^v\.\s*/i, "verse"],
      [/^l\.\s*/i, "line"],
      [/^n\.\s*/i, "note"],
      [/^col\.\s*/i, "column"],
      [/^no\.\s*/i, "issue"],
      [/^vol\.\s*/i, "volume"],
    ];
    for (const [pattern, label] of prefixes) {
      if (pattern.test(raw)) return { label, value: raw.replace(pattern, "").trim() };
    }
    return { label: "page", value: raw };
  }

  private static stripNumericBibliographyLabel(text: string): string {
    return text.replace(/^\s*(?:\[\s*\d+\s*\]|\d+[.)])\s*/, "").trim();
  }

  private static extractNumericLocator(citation: string): string | null {
    const match = citation.trim().match(/^\[\s*\d+\s*,\s*(.+)\]$/);
    return match?.[1]?.trim() || null;
  }

  private static appendLocator(text: string, locator: string): string {
    const match = text.match(/([.!?])$/);
    if (!match) return `${text}, ${locator}`;
    return `${text.slice(0, -1)}, ${locator}${match[1]}`;
  }

  private static fromZoteroItem(item: ZoteroItem): Record<string, unknown> {
    const csl: Record<string, unknown> = {
      id: item.key,
      type: ZOTERO_TO_CSL_TYPE[item.itemType] ?? "document",
      title: item.title,
    };

    const authors = item.creators.filter((creator) => creator.creatorType === "author");
    const editors = item.creators.filter((creator) => creator.creatorType === "editor");
    const toName = (creator: { firstName?: string; lastName?: string; name?: string }) =>
      creator.name
        ? { literal: creator.name }
        : { family: creator.lastName ?? "", given: creator.firstName ?? "" };
    if (authors.length) csl.author = authors.map(toName);
    if (editors.length) csl.editor = editors.map(toName);

    if (item.date) {
      const year = item.date.match(/\b(\d{4})\b/)?.[1];
      if (year) csl.issued = { "date-parts": [[Number(year)]] };
    }
    if (item.accessed) {
      const match = item.accessed.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (match) {
        csl.accessed = { "date-parts": [[Number(match[1]), Number(match[2]), Number(match[3])]] };
      }
    }
    if (item.publicationTitle) csl["container-title"] = item.publicationTitle;
    if (item.bookTitle) csl["container-title"] = item.bookTitle;
    if (item.publisher) csl.publisher = item.publisher;
    if (item.place) csl["publisher-place"] = item.place;
    if (item.volume) csl.volume = item.volume;
    if (item.issue) csl.issue = item.issue;
    if (item.pages) csl.page = item.pages;
    if (item.edition) csl.edition = item.edition;
    if (item.DOI) csl.DOI = item.DOI;
    if (item.URL) csl.URL = item.URL;
    if (item.ISBN) csl.ISBN = item.ISBN;
    if (item.university) csl.publisher = item.university;
    if (item.court || item.authority) csl.authority = item.court ?? item.authority;
    if (item.docketNumber) csl.number = item.docketNumber;
    return csl;
  }

  private static decodeEntities(text: string): string {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    return text
      .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match)
      .replace(/&#(\d+);/g, (_match, value: string) => String.fromCodePoint(Number(value)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, value: string) => String.fromCodePoint(parseInt(value, 16)));
  }
}

CslEngine.refreshConfiguration();
