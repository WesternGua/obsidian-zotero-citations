/**
 * ExportManager.ts – Pandoc export and reference document generation.
 *
 * Plugin-managed Zotero item keys are converted only in a temporary Markdown
 * copy. The user's note remains unchanged, while the bundled Better BibTeX
 * Pandoc filter turns those temporary Pandoc citations into live Zotero Word
 * fields.
 */
import { Notice, Platform } from "obsidian";
import { exec } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { promisify } from "util";
import { randomBytes } from "crypto";
import { t } from "./i18n";
import { ZoteroCitationsSettings, DEFAULT_SETTINGS } from "./settings";
import { CitationEntry, CitationManager } from "./CitationManager";
import zoteroLiveCitationsFilter from "./vendor/zotero-live-citations.lua";

export const execAsync = promisify(exec);

export interface CitationKeyResolver {
  pingBBT(): Promise<boolean>;
  getCitationKeys(itemKeys: string[]): Promise<Map<string, string>>;
  getInstalledStyle?(styleId: string): {
    uri: string;
    isNoteStyle: boolean;
    hasBibliography: boolean;
  } | null;
  getZoteroLocale?(): string;
}

export interface ZoteroDocumentPreferences {
  pref1: string;
  pref2: string;
}

export interface PreparedPandocInput {
  path: string;
  filterPath: string | null;
  filterStyleUri: string | null;
  citationCount: number;
  hasDynamicBibliography: boolean;
  documentPreferences: ZoteroDocumentPreferences | null;
  cleanup: () => Promise<void>;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

const BIBLIOGRAPHY_START = "<!-- zotero-bibliography-start -->";
const BIBLIOGRAPHY_END = "<!-- zotero-bibliography-end -->";

export function buildEnv(): Record<string, string> {
  const extraPaths = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
  return {
    ...process.env,
    PATH: `${extraPaths}:${process.env.PATH ?? ""}`,
  };
}

/** Collect every Zotero item key stored in managed citations, including an
 * orphaned endnote definition. The latter matters because it is still
 * transformed in the temporary export copy. */
export function collectManagedItemKeys(content: string): string[] {
  const keys = new Set<string>();
  for (const citation of CitationManager.parseInlineCitations(content)) {
    for (const entry of citation.entries) keys.add(entry.key);
  }
  for (const citation of CitationManager.parseEndnoteDefs(content)) {
    for (const entry of citation.entries) keys.add(entry.key);
  }
  for (const citation of CitationManager.parseInTextCitations(content)) {
    for (const entry of citation.entries) keys.add(entry.key);
  }
  return [...keys];
}

/** Convert one managed citation cluster to Pandoc citation syntax. */
export function buildPandocCitation(entries: CitationEntry[], citationKeys: Map<string, string>): string {
  const citations = entries.map((entry) => {
    const citekey = citationKeys.get(entry.key)?.trim();
    if (!citekey) throw new Error(`Missing Better BibTeX citation key for Zotero item ${entry.key}`);
    // Pandoc citation identifiers cannot contain whitespace or citation-cluster
    // delimiters. Better BibTeX normally guarantees this; fail explicitly if a
    // custom key would produce ambiguous Markdown.
    if (/\s|[\[\];]/.test(citekey)) {
      throw new Error(`Unsupported Better BibTeX citation key: ${citekey}`);
    }
    // A semicolon separates items inside a Pandoc citation cluster, while a
    // closing bracket terminates the cluster. Locators may legitimately use
    // both characters (for example, "paras. 1–3; arts. 1, 3"), so escape them
    // in the temporary Markdown. Pandoc removes the escape before the Lua
    // filter parses the locator and suffix.
    const locator = entry.page.trim().replace(/([;\]])/g, "\\$1");
    return `@${citekey}${locator ? `, ${locator}` : ""}`;
  });
  return `[${citations.join("; ")}]`;
}

/** A raw OpenXML Zotero bibliography field understood by the Zotero Word
 * plugin. It replaces only a bibliography block explicitly inserted and
 * managed by this plugin. */
export function buildDynamicBibliographyBlock(heading: string): string {
  const title = heading.trim() || "References";
  return [
    `# ${title}`,
    "",
    "```{=openxml}",
    "<w:p>",
    "<w:pPr><w:pStyle w:val=\"BodyText\"/></w:pPr>",
    "<w:r><w:fldChar w:fldCharType=\"begin\"/></w:r>",
    "<w:r><w:instrText xml:space=\"preserve\"> ADDIN ZOTERO_BIBL {\"uncited\":[],\"omitted\":[],\"custom\":[]} CSL_BIBLIOGRAPHY </w:instrText></w:r>",
    "<w:r><w:fldChar w:fldCharType=\"separate\"/></w:r>",
    "<w:r><w:rPr><w:noProof/></w:rPr><w:t>&lt;Do Zotero Refresh: bibliography&gt;</w:t></w:r>",
    "<w:r><w:fldChar w:fldCharType=\"end\"/></w:r>",
    "</w:p>",
    "```",
  ].join("\n");
}

/** Build the custom document properties read by Zotero's Word integration.
 * Word limits each custom-property chunk to 255 characters, so Zotero stores
 * the serialized document data across ZOTERO_PREF_1 and ZOTERO_PREF_2. */
export function buildZoteroDocumentPreferences(
  style: { uri: string; isNoteStyle: boolean; hasBibliography: boolean },
  locale: string,
  sessionId: string = randomBytes(6).toString("base64url").slice(0, 8),
): ZoteroDocumentPreferences {
  const xml = [
    '<data data-version="3" zotero-version="5.0.89">',
    `<session id="${escapeXmlAttribute(sessionId)}"/>`,
    `<style id="${escapeXmlAttribute(style.uri)}" locale="${escapeXmlAttribute(locale || "en-US")}" hasBibliography="${style.hasBibliography ? "1" : "0"}" bibliographyStyleHasBeenSet="0"/>`,
    "<prefs>",
    '<pref name="fieldType" value="Field"/>',
    `<pref name="noteType" value="${style.isNoteStyle ? "1" : "0"}"/>`,
    "</prefs>",
    "</data>",
  ].join("");
  return {
    pref1: xml.slice(0, 255),
    pref2: xml.slice(255),
  };
}

/** Transform managed citations in memory. No source file is modified. */
export function transformManagedCitationsForPandoc(
  content: string,
  citationKeys: Map<string, string>,
): { content: string; citationCount: number; hasDynamicBibliography: boolean } {
  const replacements: Replacement[] = [];
  let citationCount = 0;

  for (const citation of CitationManager.parseInlineCitations(content)) {
    replacements.push({
      start: citation.index,
      end: citation.index + citation.fullMatch.length,
      text: `^[${buildPandocCitation(citation.entries, citationKeys)}]`,
    });
    citationCount += citation.entries.length;
  }

  for (const citation of CitationManager.parseEndnoteDefs(content)) {
    replacements.push({
      start: citation.defIndex,
      end: citation.defIndex + citation.fullMatch.length,
      text: `[^${citation.label}]: ${buildPandocCitation(citation.entries, citationKeys)}`,
    });
    citationCount += citation.entries.length;
  }

  for (const citation of CitationManager.parseInTextCitations(content)) {
    replacements.push({
      start: citation.index,
      end: citation.index + citation.fullMatch.length,
      text: buildPandocCitation(citation.entries, citationKeys),
    });
    citationCount += citation.entries.length;
  }

  // Guard against parser changes accidentally producing overlapping edits.
  const ordered = replacements.sort((a, b) => b.start - a.start);
  for (let index = 0; index + 1 < ordered.length; index++) {
    if (ordered[index + 1].end > ordered[index].start) {
      throw new Error("Managed Zotero citation ranges overlap during Word export");
    }
  }

  let transformed = content;
  for (const replacement of ordered) {
    transformed = transformed.slice(0, replacement.start) + replacement.text + transformed.slice(replacement.end);
  }

  let hasDynamicBibliography = false;
  const bibStart = transformed.indexOf(BIBLIOGRAPHY_START);
  const bibEnd = transformed.indexOf(BIBLIOGRAPHY_END, bibStart + BIBLIOGRAPHY_START.length);
  if (citationCount > 0 && bibStart !== -1 && bibEnd !== -1) {
    const blockEnd = bibEnd + BIBLIOGRAPHY_END.length;
    const managedBlock = transformed.slice(bibStart + BIBLIOGRAPHY_START.length, bibEnd);
    const heading = managedBlock.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim() || "References";
    transformed = transformed.slice(0, bibStart)
      + buildDynamicBibliographyBlock(heading)
      + transformed.slice(blockEnd);
    hasDynamicBibliography = true;
  }

  return { content: transformed, citationCount, hasDynamicBibliography };
}

export class ExportManager {
  static async exportToWord(
    inputPath: string,
    outputPath: string,
    settings: ZoteroCitationsSettings,
    resolver: CitationKeyResolver,
  ): Promise<void> {
    const pandoc = settings.pandocPath.trim() || "pandoc";
    const extraFlags = settings.pandocFlags.trim();
    const prepared = await ExportManager.preparePandocInput(inputPath, resolver, settings);
    try {
      const { ReferenceDocGenerator } = await import("./ReferenceDocGenerator");
      const refDoc = await ReferenceDocGenerator.generate();
      const cmd = [
        ExportManager.q(pandoc),
        ExportManager.q(prepared.path),
        "-o",
        ExportManager.q(outputPath),
        "-f",
        "markdown",
        "--to",
        "docx",
        "--wrap=none",
        `--reference-doc=${ExportManager.q(refDoc)}`,
        prepared.filterPath ? "--lua-filter" : "",
        prepared.filterPath ? ExportManager.q(prepared.filterPath) : "",
        prepared.filterPath ? ExportManager.q("--metadata=zotero_client:zotero") : "",
        prepared.filterStyleUri ? ExportManager.q(`--metadata=zotero_csl-style:${prepared.filterStyleUri}`) : "",
        prepared.documentPreferences ? ExportManager.q(`--metadata=ZOTERO_PREF_1:${prepared.documentPreferences.pref1}`) : "",
        prepared.documentPreferences ? ExportManager.q(`--metadata=ZOTERO_PREF_2:${prepared.documentPreferences.pref2}`) : "",
        extraFlags,
      ].filter(Boolean).join(" ");
      try {
        await execAsync(cmd, { timeout: 120000, env: buildEnv() });
      } catch (err: unknown) {
        throw new ExportError(t(settings, "export.pandocFailed", {
          error: getErrorMessage(err),
        }));
      }
    } finally {
      await prepared.cleanup();
    }
  }

  static async preparePandocInput(
    inputPath: string,
    resolver: CitationKeyResolver,
    settings: ZoteroCitationsSettings = DEFAULT_SETTINGS,
  ): Promise<PreparedPandocInput> {
    const content = await fs.readFile(inputPath, "utf8");
    const itemKeys = collectManagedItemKeys(content);
    if (!itemKeys.length) {
      return {
        path: inputPath,
        filterPath: null,
        filterStyleUri: null,
        citationCount: 0,
        hasDynamicBibliography: false,
        documentPreferences: null,
        cleanup: async () => {},
      };
    }

    if (!settings.cslStyle.trim()) {
      throw new ExportError(t(settings, "export.styleMissing"));
    }
    if (!await resolver.pingBBT()) {
      throw new ExportError(t(settings, "export.bbtMissing"));
    }

    const citationKeys = await resolver.getCitationKeys(itemKeys);
    const missing = itemKeys.filter((key) => !citationKeys.get(key)?.trim());
    if (missing.length) {
      throw new ExportError(t(settings, "export.citationKeysMissing", { keys: missing.join(", ") }));
    }

    let transformed: ReturnType<typeof transformManagedCitationsForPandoc>;
    try {
      transformed = transformManagedCitationsForPandoc(content, citationKeys);
    } catch (error) {
      throw new ExportError(t(settings, "export.citationTransformFailed", { error: getErrorMessage(error) }));
    }

    const installedStyle = resolver.getInstalledStyle
      ? resolver.getInstalledStyle(settings.cslStyle)
      : {
          uri: `http://www.zotero.org/styles/${settings.cslStyle}`,
          isNoteStyle: false,
          hasBibliography: true,
        };
    if (!installedStyle?.uri) {
      throw new ExportError(t(settings, "export.styleMissing"));
    }
    const documentPreferences = buildZoteroDocumentPreferences(
      installedStyle,
      resolver.getZoteroLocale?.() || "en-US",
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zotero-citations-export-"));
    try {
      const tempPath = path.join(tempDir, path.basename(inputPath));
      const filterPath = path.join(tempDir, "zotero-live-citations.lua");
      await Promise.all([
        fs.writeFile(tempPath, transformed.content, "utf8"),
        fs.writeFile(filterPath, zoteroLiveCitationsFilter, "utf8"),
      ]);
      return {
        path: tempPath,
        filterPath,
        filterStyleUri: installedStyle.uri,
        citationCount: transformed.citationCount,
        hasDynamicBibliography: transformed.hasDynamicBibliography,
        documentPreferences,
        cleanup: async () => {
          await fs.rm(tempDir, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  /** Kept for callers/tests that used the old plain-text in-text export helper. */
  static stripInTextMarkersForExport(content: string): string {
    const citations = CitationManager.parseInTextCitations(content);
    if (!citations.length) return content;
    let out = content;
    for (let i = citations.length - 1; i >= 0; i--) {
      const c = citations[i];
      out = out.slice(0, c.index) + c.formattedText + out.slice(c.index + c.fullMatch.length);
    }
    return out;
  }

  static showNativeSaveDialog(_defaultPath: string, _settings: ZoteroCitationsSettings = DEFAULT_SETTINGS): string | null | undefined {
    return undefined;
  }

  static suggestOutputPath(inputPath: string, settings: ZoteroCitationsSettings): string {
    const dir = settings.useDefaultExportDir && settings.exportOutputDir.trim()
      ? settings.exportOutputDir.trim()
      : path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    return path.join(dir, `${base}.docx`);
  }

  static async verifyAndNotify(settings: ZoteroCitationsSettings): Promise<void> {
    const pandoc = settings.pandocPath.trim() || "pandoc";
    try {
      const { stdout } = await execAsync(`${ExportManager.q(pandoc)} --version`, { timeout: 10000, env: buildEnv() });
      new Notice(`✓ ${stdout.split("\n")[0].trim()}`, 4000);
    } catch {
      new Notice(t(settings, "export.pandocMissing", { pandoc }), 8000);
    }
  }

  static q(s: string): string {
    if (!s) return "";
    return Platform.isWin
      ? `"${s.replace(/"/g, '\\"')}"`
      : `'${s.replace(/'/g, "'\\''")}'`;
  }
}

export class ExportError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ExportError";
  }
}

function getErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const stderr = "stderr" in err ? err.stderr : undefined;
    if (typeof stderr === "string" && stderr.trim()) return stderr;
    const message = "message" in err ? err.message : undefined;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(err);
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}
