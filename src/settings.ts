/**
 * settings.ts – Plugin settings, CSL styles, and the SettingTab
 */
import { PluginSettingTab, Setting, App, requestUrl, Notice, Plugin } from "obsidian";
import * as nodeHttp from "http";
import { t, getLanguage, type Language, type LanguageSettings } from "./i18n";
import { CitationManager, type MinimalEditor, type CitationRef } from "./CitationManager";
import { CslEngine } from "./CslEngine";
import type { InstalledStyle, ZoteroItem, ZoteroAPI } from "./ZoteroAPI";

const INSTALLED_STYLE_TITLES = new Map<string, string>();

export function syncInstalledStyles(api: ZoteroAPI): InstalledStyle[] {
  CslEngine.refreshConfiguration(
    api.locateZoteroStylesDir(),
    api.getZoteroLocale(),
    api.getIncludePaperArticleUrls(),
  );
  const styles = api.getInstalledStyles();
  INSTALLED_STYLE_TITLES.clear();
  for (const style of styles) INSTALLED_STYLE_TITLES.set(style.id, style.title);
  return styles;
}

// ── Toolbar button config (Improvement 3) ─────────────────────────────────
export interface ToolbarButtons {
  export: boolean;
  unlink: boolean;
  changeStyle: boolean;
  refresh: boolean;
  wordDisplay: boolean;
  insertCitation: boolean;
}

// ── Settings interface ─────────────────────────────────────────────────────
export interface ZoteroCitationsSettings {
  cslStyle: string;
  citationMode: string;
  showWordStyleFootnotes: boolean;
  showToolbar: boolean;
  toolbarButtons: ToolbarButtons;
  pandocPath: string;
  pandocFlags: string;
  useDefaultExportDir: boolean;
  exportOutputDir: string;
  zoteroPort: number;
  language: string;
}

export const DEFAULT_SETTINGS: ZoteroCitationsSettings = {
  cslStyle: "",
  citationMode: "endnote",
  showWordStyleFootnotes: true,
  showToolbar: true,
  toolbarButtons: {
    export: true,
    unlink: true,
    changeStyle: true,
    refresh: true,
    wordDisplay: true,
    insertCitation: true,
  },
  pandocPath: "pandoc",
  pandocFlags: "",
  useDefaultExportDir: false,
  exportOutputDir: "",
  zoteroPort: 23119,
  language: "zh",
};

// ── Helpers ────────────────────────────────────────────────────────────────
export function getStyleName(styleId: string, settingsOrLang: Language | LanguageSettings): string {
  void settingsOrLang;
  return INSTALLED_STYLE_TITLES.get(styleId) ?? styleId;
}

export function getModeLabel(mode: string, settingsOrLang: Language | LanguageSettings, variant: string = "option"): string {
  return t(settingsOrLang, `mode.${mode}.${variant}`);
}

export function getItemTypeLabel(itemType: string, settingsOrLang: Language | LanguageSettings): string {
  return t(settingsOrLang, `itemType.${itemType}`);
}

interface ZoteroPluginLike extends Plugin {
  settings: ZoteroCitationsSettings;
  api: ZoteroAPI;
  saveSettings: () => Promise<void>;
  applyLanguage: () => void;
  getEditor: () => MinimalEditor | null;
  resolveItems: (keys: string[]) => Promise<Map<string, ZoteroItem> | null>;
  refreshEditorExtension: () => void;
  refreshToolbars: () => void;
  getCommandLabels: () => Record<string, string>;
  ensureInstalledStyle: () => boolean;
}

// ── Setting Tab ────────────────────────────────────────────────────────────
export class ZoteroSettingTab extends PluginSettingTab {
  plugin: ZoteroPluginLike;
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;

  constructor(app: App, plugin: ZoteroPluginLike) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    // ── Interface language ──
    new Setting(containerEl).setName(t(this.plugin.settings, "settings.interface")).setHeading();
    new Setting(containerEl)
      .setName(t(this.plugin.settings, "settings.interface"))
      .setDesc(t(this.plugin.settings, "settings.interfaceDesc"))
      .addDropdown((dd) => {
        dd.addOption("zh", t(this.plugin.settings, "lang.zh"));
        dd.addOption("en", t(this.plugin.settings, "lang.en"));
        dd.setValue(getLanguage(this.plugin.settings));
        dd.onChange((v: string) => {
          void (async () => {
            this.plugin.settings.language = v === "en" ? "en" : "zh";
            await this.plugin.saveSettings();
            this.plugin.applyLanguage();
            await this.display();
          })();
        });
      });

    // ── Connection status ──
    new Setting(containerEl).setName(t(this.plugin.settings, "settings.connection")).setHeading();
    const row = containerEl.createDiv({ cls: "zotero-status-row" });
    this.statusDot = row.createSpan({ cls: "zotero-status-dot zotero-status-unknown" });
    this.statusText = row.createSpan({ text: t(this.plugin.settings, "settings.checking") });
    const btn = containerEl.createEl("button", {
      text: t(this.plugin.settings, "settings.recheck"),
      cls: "zotero-settings-check-button",
    });
    btn.addEventListener("click", () => { void this.checkConnection(); });
    void this.checkConnection();

    // ── Citation style ──
    new Setting(containerEl).setName(t(this.plugin.settings, "settings.citationStyleSection")).setHeading();

    let styleOptions: InstalledStyle[] = [];
    try {
      styleOptions = syncInstalledStyles(this.plugin.api);
    } catch {
      styleOptions = [];
    }

    const styleSetting = new Setting(containerEl)
      .setName(t(this.plugin.settings, "settings.defaultStyle"))
      .setDesc(t(this.plugin.settings, "settings.defaultStyleDesc"))
      .addDropdown((dd) => {
        for (const s of styleOptions) dd.addOption(s.id, s.title);
        const selectedExists = styleOptions.some((s) => s.id === this.plugin.settings.cslStyle);
        if (!styleOptions.length) {
          dd.addOption("", t(this.plugin.settings, "settings.noStylesInstalled"));
        } else if (!selectedExists) {
          dd.addOption("", t(this.plugin.settings, "settings.selectInstalledStyle"));
        }
        dd.setValue(selectedExists ? this.plugin.settings.cslStyle : "");
        dd.onChange((v: string) => {
          void (async () => {
            this.plugin.settings.cslStyle = v;
            await this.plugin.saveSettings();
          })();
        });
      });
    styleSetting.setClass("zotero-style-setting");

    new Setting(containerEl)
      .setName(t(this.plugin.settings, "settings.refreshStyles"))
      .setDesc(t(this.plugin.settings, "settings.refreshStylesDesc"))
      .addButton((btn) => {
        btn.setButtonText(t(this.plugin.settings, "settings.refreshStyles"));
        btn.onClick(() => {
          btn.setDisabled(true);
          try {
            const refreshed = syncInstalledStyles(this.plugin.api);
            void this.display();
            new Notice(t(this.plugin.settings, "prefs.stylesRefreshed", { count: refreshed.length }));
          } finally {
            btn.setDisabled(false);
          }
        });
      });

    // ── Citation mode ──
    new Setting(containerEl)
      .setName(t(this.plugin.settings, "settings.citationMode"))
      .setDesc(t(this.plugin.settings, "settings.citationModeDesc"))
      .addDropdown((dd) => {
        dd.addOption("endnote", getModeLabel("endnote", this.plugin.settings, "option"));
        dd.addOption("inline", getModeLabel("inline", this.plugin.settings, "option"));
        dd.addOption("intext", getModeLabel("intext", this.plugin.settings, "option"));
        dd.setValue(this.plugin.settings.citationMode);
        dd.onChange((v: string) => {
          void (async () => {
            this.plugin.settings.citationMode = v;
            await this.plugin.saveSettings();
            const editor = this.plugin.getEditor();
            if (!editor) return;
            const content = editor.getValue();
            const all = CitationManager.parseAllCitations(content);
            if (!all.length) {
              this.plugin.refreshEditorExtension();
              return;
            }
            if (!this.plugin.ensureInstalledStyle()) return;
            const keys = [...new Set(all.map((c: CitationRef) => c.key))];
            const itemMap = await this.plugin.resolveItems(keys);
            if (!itemMap) return;
            let count: number;
            try {
              count = CitationManager.refreshDocument(editor, itemMap, this.plugin.settings.cslStyle, v);
            } catch (error) {
              new Notice(t(this.plugin.settings, "notice.styleFormatFailed", { error: String(error) }), 8000);
              return;
            }
            this.plugin.refreshEditorExtension();
            new Notice(t(this.plugin.settings, "settings.switchModeNotice", {
              mode: getModeLabel(v, this.plugin.settings, "short"),
              count,
            }));
          })();
        });
      });

    // ── Editor display ──
    new Setting(containerEl).setName(t(this.plugin.settings, "settings.editorDisplaySection")).setHeading();
    new Setting(containerEl)
      .setName(t(this.plugin.settings, "settings.wordDisplay"))
      .setDesc(t(this.plugin.settings, "settings.wordDisplayDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showWordStyleFootnotes);
        toggle.onChange((v: boolean) => {
          void (async () => {
            this.plugin.settings.showWordStyleFootnotes = v;
            await this.plugin.saveSettings();
            this.plugin.refreshEditorExtension();
          })();
        });
      });

    // ── Toolbar master toggle ──
    new Setting(containerEl)
      .setName(t(this.plugin.settings, "settings.showToolbar"))
      .setDesc(t(this.plugin.settings, "settings.showToolbarDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showToolbar);
        toggle.onChange((v: boolean) => {
          void (async () => {
            this.plugin.settings.showToolbar = v;
            await this.plugin.saveSettings();
            this.plugin.refreshToolbars();
            await this.display(); // re-render to show/hide sub-toggles
          })();
        });
      });

    // ── Improvement 3: Individual toolbar button toggles ──
    if (this.plugin.settings.showToolbar) {
      const toolbarSection = containerEl.createDiv({ cls: "zotero-toolbar-buttons-section" });

      const buttonKeys: { key: keyof ToolbarButtons; labelKey: string }[] = [
        { key: "export", labelKey: "settings.toolbarBtn.export" },
        { key: "unlink", labelKey: "settings.toolbarBtn.unlink" },
        { key: "changeStyle", labelKey: "settings.toolbarBtn.changeStyle" },
        { key: "refresh", labelKey: "settings.toolbarBtn.refresh" },
        { key: "wordDisplay", labelKey: "settings.toolbarBtn.wordDisplay" },
        { key: "insertCitation", labelKey: "settings.toolbarBtn.insertCitation" },
      ];

      for (const { key, labelKey } of buttonKeys) {
        new Setting(toolbarSection)
          .setName(t(this.plugin.settings, labelKey))
          .addToggle((toggle) => {
            toggle.setValue(this.plugin.settings.toolbarButtons[key]);
            toggle.onChange((v: boolean) => {
              void (async () => {
                this.plugin.settings.toolbarButtons[key] = v;
                await this.plugin.saveSettings();
                this.plugin.refreshToolbars();
              })();
            });
          });
      }
    }

    // ── Export section ──
    new Setting(containerEl).setName(t(this.plugin.settings, "settings.exportSection")).setHeading();
    new Setting(containerEl)
      .setName(t(this.plugin.settings, "settings.pandocPath"))
      .setDesc(t(this.plugin.settings, "settings.pandocPathDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t(this.plugin.settings, "settings.pandocPathPlaceholder"))
          .setValue(this.plugin.settings.pandocPath)
          .onChange((v: string) => {
            void (async () => {
              this.plugin.settings.pandocPath = v.trim() || "pandoc";
              await this.plugin.saveSettings();
            })();
          })
      );
    new Setting(containerEl)
      .setName(t(this.plugin.settings, "settings.pandocFlags"))
      .setDesc(t(this.plugin.settings, "settings.pandocFlagsDesc"))
      .addText((text) =>
        text.setPlaceholder("").setValue(this.plugin.settings.pandocFlags).onChange((v: string) => {
          void (async () => {
            this.plugin.settings.pandocFlags = v.trim();
            await this.plugin.saveSettings();
          })();
        })
      );
    new Setting(containerEl)
      .setName(t(this.plugin.settings, "settings.useDefaultExportDir"))
      .setDesc(t(this.plugin.settings, "settings.useDefaultExportDirDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.useDefaultExportDir);
        toggle.onChange((v: boolean) => {
          void (async () => {
            this.plugin.settings.useDefaultExportDir = v;
            await this.plugin.saveSettings();
            await this.display();
          })();
        });
      });
    if (this.plugin.settings.useDefaultExportDir) {
      new Setting(containerEl)
        .setName(t(this.plugin.settings, "settings.defaultExportDir"))
        .setDesc(t(this.plugin.settings, "settings.defaultExportDirDesc"))
        .addText((text) =>
          text
            .setPlaceholder(t(this.plugin.settings, "settings.defaultExportDirPlaceholder"))
            .setValue(this.plugin.settings.exportOutputDir)
            .onChange((v: string) => {
              void (async () => {
                this.plugin.settings.exportOutputDir = v.trim();
                await this.plugin.saveSettings();
              })();
            })
        );
    }

    // ── Command list ──
    new Setting(containerEl).setName(t(this.plugin.settings, "settings.commandsSection")).setHeading();
    const cmds = Object.values(this.plugin.getCommandLabels());
    const ul = containerEl.createEl("ul");
    for (const c of cmds) {
      ul.createEl("li", { text: c, cls: "zotero-settings-command" });
    }
  }

  private async checkConnection(): Promise<void> {
    this.statusDot.className = "zotero-status-dot zotero-status-unknown";
    this.statusText.textContent = t(this.plugin.settings, "settings.checking");

    const port = Number(this.plugin.settings.zoteroPort) || 23119;
    const setConnected = () => {
      this.statusDot.className = "zotero-status-dot zotero-status-ok";
      this.statusText.textContent = t(this.plugin.settings, "status.connected");
    };
    const setDisconnected = () => {
      this.statusDot.className = "zotero-status-dot zotero-status-err";
      this.statusText.textContent = t(this.plugin.settings, "status.disconnected");
    };

    const probeViaNodeHttp = (path: string): Promise<boolean> => {
      return new Promise((resolve) => {
        const req = nodeHttp.request(
          {
            hostname: "127.0.0.1",
            port,
            path,
            method: "GET",
            timeout: 2000,
          },
          (res) => {
            const zoteroVersion = res.headers["x-zotero-version"];
            const apiVersion = res.headers["x-zotero-connector-api-version"];
            resolve(res.statusCode === 200 || Boolean(zoteroVersion || apiVersion));
          }
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
        req.end();
      });
    };

    try {
      if (this.plugin.api && typeof this.plugin.api.ping === "function") {
        const ok = await this.plugin.api.ping();
        if (ok) {
          setConnected();
          return;
        }
      }

      // Prefer Node HTTP probing: avoids requestUrl quirks in some Obsidian setups.
      if (await probeViaNodeHttp("/connector/ping")) {
        setConnected();
        return;
      }
      if (await probeViaNodeHttp("/better-bibtex/cayw?format=json")) {
        setConnected();
        return;
      }

      // Final fallback: requestUrl
      const resp = await requestUrl({
        url: `http://127.0.0.1:${port}/connector/ping`,
        method: "GET",
        throw: false,
      });
      if (resp.status === 200) {
        setConnected();
        return;
      }

      setDisconnected();
    } catch {
      setDisconnected();
    }
  }
}
