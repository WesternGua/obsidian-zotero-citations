import { Platform } from "obsidian";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function profileRootCandidates(): string[] {
  const home = os.homedir();
  if (Platform.isMacOS) {
    return [path.join(home, "Library", "Application Support", "Zotero")];
  }
  if (Platform.isWin) {
    const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appdata, "Zotero", "Zotero")];
  }
  return [path.join(home, ".zotero", "zotero")];
}

function parseDefaultProfile(root: string): string | null {
  const iniPath = path.join(root, "profiles.ini");
  try {
    const text = fs.readFileSync(iniPath, "utf-8");
    const sections = text.split(/^\s*\[/m).map((section, index) => index === 0 ? section : `[${section}`);
    const profiles = sections.filter((section) => /^\[Profile\d+\]/m.test(section));
    const preferred = profiles.find((section) => /^Default=1\s*$/m.test(section)) ?? profiles[0];
    if (!preferred) return null;
    const pathMatch = preferred.match(/^Path=(.+)$/m);
    if (!pathMatch) return null;
    const profilePath = pathMatch[1].trim();
    const isRelative = /^IsRelative=1\s*$/m.test(preferred);
    return isRelative ? path.join(root, profilePath) : profilePath;
  } catch {
    return null;
  }
}

export function locateZoteroProfileDir(): string | null {
  for (const root of profileRootCandidates()) {
    const fromIni = parseDefaultProfile(root);
    if (fromIni && fs.existsSync(fromIni)) return fromIni;

    const profilesDir = path.join(root, "Profiles");
    try {
      const profiles = fs.readdirSync(profilesDir)
        .map((name) => path.join(profilesDir, name))
        .filter((candidate) => fs.statSync(candidate).isDirectory());
      const preferred = profiles.find((candidate) => /\.default(?:-release)?$/i.test(candidate)) ?? profiles[0];
      if (preferred) return preferred;
    } catch {
      // Try the next platform-specific location.
    }
  }
  return null;
}

export function locateZoteroStylesDir(): string | null {
  const home = os.homedir();
  const profile = locateZoteroProfileDir();
  if (profile) {
    try {
      const prefs = fs.readFileSync(path.join(profile, "prefs.js"), "utf-8");
      const usesCustomDir = /user_pref\("extensions\.zotero\.useDataDir",\s*true\);/.test(prefs);
      const dataDirMatch = prefs.match(/user_pref\("extensions\.zotero\.dataDir",\s*"((?:\\.|[^"])*)"\);/);
      if (usesCustomDir && dataDirMatch?.[1]) {
        const customStyles = path.join(decodePrefString(dataDirMatch[1]), "styles");
        if (fs.statSync(customStyles).isDirectory()) return customStyles;
      }
    } catch {
      // Fall through to Zotero's default data directory.
    }
  }
  const directCandidates = Platform.isWin
    ? [path.join(home, "Zotero", "styles")]
    : [path.join(home, "Zotero", "styles")];

  for (const candidate of directCandidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Try the profile data directory below.
    }
  }

  if (!profile) return null;
  const profileStyles = path.join(profile, "styles");
  try {
    return fs.statSync(profileStyles).isDirectory() ? profileStyles : null;
  } catch {
    return null;
  }
}

function decodePrefString(value: string): string {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function normalizeLocale(locale: string): string {
  const cleaned = locale.trim().replace(/_/g, "-");
  if (!cleaned) return "en-US";
  try {
    return Intl.getCanonicalLocales(cleaned)[0] ?? "en-US";
  } catch {
    return cleaned;
  }
}

function systemLocale(): string {
  try {
    return normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale || "en-US");
  } catch {
    return "en-US";
  }
}

/** Read Zotero's own locale preference so citeproc uses the same quotation and date rules. */
export function readZoteroLocale(): string {
  const profile = locateZoteroProfileDir();
  if (!profile) return systemLocale();
  try {
    const prefs = fs.readFileSync(path.join(profile, "prefs.js"), "utf-8");
    const preferenceNames = [
      "extensions.zotero.export.bibliographyLocale",
      "extensions.zotero.export.quickCopy.locale",
      "intl.locale.requested",
    ];
    for (const name of preferenceNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = prefs.match(new RegExp(`user_pref\\(\"${escaped}\",\\s*\"((?:\\\\.|[^\"])*)\"\\);`));
      if (match?.[1]) return normalizeLocale(decodePrefString(match[1]));
    }
  } catch {
    // Use the CSL default below.
  }
  return systemLocale();
}

/** Match Zotero's “Include URLs of paper articles in references” preference. */
export function readZoteroIncludePaperArticleUrls(): boolean {
  const profile = locateZoteroProfileDir();
  if (!profile) return false;
  try {
    const prefs = fs.readFileSync(path.join(profile, "prefs.js"), "utf-8");
    const match = prefs.match(/user_pref\("extensions\.zotero\.export\.includeURL",\s*(true|false)\);/);
    return match?.[1] === "true";
  } catch {
    return false;
  }
}
