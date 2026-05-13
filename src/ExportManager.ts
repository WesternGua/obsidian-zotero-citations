/**
 * ExportManager.ts – Pandoc export and reference document generation
 */
import { Notice, Platform } from "obsidian";
import { exec } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { promisify } from "util";
import { t } from "./i18n";
import { ZoteroCitationsSettings, DEFAULT_SETTINGS } from "./settings";
import { CitationManager } from "./CitationManager";

export const execAsync = promisify(exec);

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

export class ExportManager {
  static async exportToWord(inputPath: string, outputPath: string, settings: ZoteroCitationsSettings): Promise<void> {
    const pandoc = settings.pandocPath.trim() || "pandoc";
    const extraFlags = settings.pandocFlags.trim();
    const { ReferenceDocGenerator } = await import("./ReferenceDocGenerator");
    const refDoc = await ReferenceDocGenerator.generate();
    const prepared = await ExportManager.preparePandocInput(inputPath);
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
      extraFlags,
    ].filter(Boolean).join(" ");
    try {
      await execAsync(cmd, { timeout: 120000, env: buildEnv() });
    } catch (err: unknown) {
      throw new ExportError(t(settings, "export.pandocFailed", {
        error: getErrorMessage(err),
      }));
    } finally {
      await prepared.cleanup();
    }
  }

  static async preparePandocInput(inputPath: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const content = await fs.readFile(inputPath, "utf8");
    const transformed = ExportManager.stripInTextMarkersForExport(content);
    if (transformed === content) {
      return { path: inputPath, cleanup: async () => {} };
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zotero-citations-export-"));
    const tempPath = path.join(tempDir, path.basename(inputPath));
    await fs.writeFile(tempPath, transformed, "utf8");
    return {
      path: tempPath,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  }

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
