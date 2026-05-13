/**
 * main.ts – Obsidian plugin entry for Zotero Citations
 * Reconstructed from the existing bundled plugin so the source tree is buildable again.
 */
import * as obsidian from "obsidian";
import { CitationManager, EndnoteDef, InTextCitation, InlineCitation } from "./CitationManager";
import { ExportManager } from "./ExportManager";
import { createFootnoteExtension } from "./extensions/FootnoteExtension";
import { appT, t } from "./i18n";
import { ExportModal } from "./modals/ExportModal";
import { PreferencesModal } from "./modals/PreferencesModal";
import { SearchModal } from "./modals/SearchModal";
import { DEFAULT_SETTINGS, ZoteroCitationsSettings, ZoteroSettingTab } from "./settings";
import {
  CaywResult,
  formatLocator,
  ZoteroAPI,
  ZoteroConnectionError,
  ZoteroItem,
  ZoteroPickerError,
} from "./ZoteroAPI";

type EditorLike = any;

type SelectionSnapshot = {
  from: any;
  to: any;
};

type AppWithCommands = obsidian.App & {
  commands?: {
    commands?: Record<string, { name: string }>;
    executeCommandById?: (commandId: string) => void;
  };
};

const ZOTERO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="80" rx="10" fill="currentColor" opacity="0.12"/>
  <text x="50" y="70" font-size="58" text-anchor="middle" font-family="serif" fill="currentColor" font-weight="bold">Z</text>
</svg>`;

const ZOTERO_CITE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M7 8h5v5H7z"/>
  <path d="M12 8h5v5h-5z"/>
  <path d="M9.5 13v3a2 2 0 0 1-2 2H6"/>
  <path d="M16.5 13v3a2 2 0 0 1-2 2H13"/>
</svg>`;

const ZOTERO_WORD_DISPLAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 18h8"/>
  <path d="M9 18V7.5l-2 1.7"/>
  <path d="M15.5 9.5l1.7-3.5"/>
  <path d="M19 9.5l-1.7-3.5"/>
  <path d="M16 7h2.5"/>
</svg>`;

const ZOTERO_STYLE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 18h6"/>
  <path d="M4 12h10"/>
  <path d="M4 6h14"/>
  <path d="m16 17 2-10 2 10"/>
  <path d="M15.2 13h5.6"/>
</svg>`;

const ZOTERO_EXPORT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
  <path d="M14 3v5h5"/>
  <path d="M12 11v6"/>
  <path d="m9.5 14.5 2.5 2.5 2.5-2.5"/>
</svg>`;

const ZOTERO_REFRESH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 6v5h-5"/>
  <path d="M4 18v-5h5"/>
  <path d="M18.2 10A7 7 0 0 0 6 7.2L4 9"/>
  <path d="M5.8 14A7 7 0 0 0 18 16.8l2-1.8"/>
</svg>`;

const ZOTERO_UNLINK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 14 5 19"/>
  <path d="m14 10 5-5"/>
  <path d="m8.5 8.5 7 7"/>
  <path d="M7 14H5a3 3 0 0 1 0-6h3"/>
  <path d="M16 10h3a3 3 0 0 1 0 6h-3"/>
</svg>`;

export default class ZoteroCitations extends obsidian.Plugin {
  api!: ZoteroAPI;
  settings!: ZoteroCitationsSettings;
  itemCache: Map<string, ZoteroItem> = new Map();

  // Reference to the registered editor extension so we can refresh it
  editorExtension: any = null;
  ribbonIconEl: HTMLElement | null = null;
  titlebarActions: WeakMap<any, HTMLElement[]> = new WeakMap();
  focusBurstTimer: number | null = null;
  focusBurstStopTimer: number | null = null;
  focusBurstTopmostResetTimer: number | null = null;

  async onload() {
    await this.loadSettings();
    this.api = new ZoteroAPI(this.settings.zoteroPort);

    obsidian.addIcon("zotero-z", ZOTERO_ICON);
    obsidian.addIcon("zotero-cite", ZOTERO_CITE_ICON);
    obsidian.addIcon("zotero-word-display", ZOTERO_WORD_DISPLAY_ICON);
    obsidian.addIcon("zotero-style", ZOTERO_STYLE_ICON);
    obsidian.addIcon("zotero-export", ZOTERO_EXPORT_ICON);
    obsidian.addIcon("zotero-refresh", ZOTERO_REFRESH_ICON);
    obsidian.addIcon("zotero-unlink", ZOTERO_UNLINK_ICON);

    this.ribbonIconEl = this.addRibbonIcon("zotero-z", this.t("ribbon.preferences"), () => this.openPreferences());

    this.editorExtension = createFootnoteExtension({
      isEnabled: () => this.settings.showWordStyleFootnotes,
      app: this.app,
      getSourcePath: () => this.app.workspace.getActiveFile()?.path ?? "",
    });
    this.registerEditorExtension(this.editorExtension);
    this.registerMarkdownPostProcessor((el) => this.decorateRenderedFootnotes(el));

    const commandLabels = this.getCommandLabels();
    this.addCommand({
      id: "insert-edit-citation",
      name: commandLabels["insert-edit-citation"],
      editorCallback: (editor) => this.insertOrEditCitation(editor),
    });
    this.addCommand({
      id: "toggle-word-display",
      name: commandLabels["toggle-word-display"],
      callback: () => this.toggleWordDisplay(),
    });
    this.addCommand({
      id: "toggle-toolbar",
      name: commandLabels["toggle-toolbar"],
      callback: () => this.toggleToolbar(),
    });
    this.addCommand({
      id: "insert-bibliography",
      name: commandLabels["insert-bibliography"],
      editorCallback: async (editor) => this.insertBibliography(editor),
    });
    this.addCommand({
      id: "refresh-citations",
      name: commandLabels["refresh-citations"],
      editorCallback: async (editor) => this.refreshAll(editor),
    });
    this.addCommand({
      id: "export-to-word",
      name: commandLabels["export-to-word"],
      callback: () => this.exportToWord(),
    });
    this.addCommand({
      id: "unlink-citations",
      name: commandLabels["unlink-citations"],
      editorCallback: (editor) => this.unlinkCitations(editor),
    });
    this.addCommand({
      id: "document-preferences",
      name: commandLabels["document-preferences"],
      callback: () => this.openPreferences(),
    });
    this.addCommand({
      id: "check-pandoc",
      name: commandLabels["check-pandoc"],
      callback: () => ExportManager.verifyAndNotify(this.settings),
    });

    this.addSettingTab(new ZoteroSettingTab(this.app, this));
    this.applyLanguage();

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshToolbars()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshToolbars()));
    this.app.workspace.onLayoutReady(() => this.refreshToolbars());
  }

  onunload() {
    if (this.focusBurstTimer) window.clearInterval(this.focusBurstTimer);
    if (this.focusBurstStopTimer) window.clearTimeout(this.focusBurstStopTimer);
    if (this.focusBurstTopmostResetTimer) window.clearTimeout(this.focusBurstTopmostResetTimer);

    this.focusBurstTimer = null;
    this.focusBurstStopTimer = null;
    this.focusBurstTopmostResetTimer = null;

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof obsidian.MarkdownView) {
        this.clearToolbar(leaf.view);
      }
    });
  }

  // ══ Settings ══════════════════════════════════════════════════════════════
  async loadSettings() {
    const data = (await this.loadData()) as {
      settings?: Partial<ZoteroCitationsSettings>;
      itemCache?: Record<string, ZoteroItem>;
    } | null;

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
    this.settings.toolbarButtons = Object.assign({}, DEFAULT_SETTINGS.toolbarButtons, this.settings.toolbarButtons);
    if (!["endnote", "inline", "intext"].includes(this.settings.citationMode)) {
      this.settings.citationMode = DEFAULT_SETTINGS.citationMode;
    }
    this.itemCache = new Map(Object.entries(data?.itemCache ?? {}));
  }

  async saveSettings() {
    await this.saveData({
      settings: this.settings,
      itemCache: Object.fromEntries(this.itemCache),
    });
  }

  t(key: string, vars?: Record<string, any>) {
    return t(this.settings, key, vars);
  }

  getCommandLabels() {
    return {
      "insert-edit-citation": this.t("command.insertCitation"),
      "toggle-word-display": this.t("command.toggleWordDisplay"),
      "toggle-toolbar": this.t("command.toggleToolbar"),
      "insert-bibliography": this.t("command.insertBibliography"),
      "refresh-citations": this.t("command.refreshCitations"),
      "export-to-word": this.t("command.exportToWord"),
      "unlink-citations": this.t("command.unlinkCitations"),
      "document-preferences": this.t("command.documentPreferences"),
      "check-pandoc": this.t("command.checkPandoc"),
    };
  }

  syncCommandLabels() {
    const labels = this.getCommandLabels();
    const commands = (this.app as AppWithCommands).commands?.commands ?? {};

    for (const [id, name] of Object.entries(labels)) {
      const fullId = `${this.manifest.id}:${id}`;
      if (commands[fullId]) commands[fullId].name = name;
    }
  }

  syncRibbonLabel() {
    if (!this.ribbonIconEl) return;
    const label = this.t("ribbon.preferences");
    this.ribbonIconEl.setAttribute("aria-label", label);
    this.ribbonIconEl.setAttribute("title", label);
    this.ribbonIconEl.setAttribute("data-tooltip", label);
  }

  applyLanguage() {
    this.syncCommandLabels();
    this.syncRibbonLabel();
    this.refreshToolbars();
  }

  /** Force Markdown views to re-render so Word-style footnote settings update everywhere. */
  refreshEditorExtension() {
    this.app.workspace.updateOptions();
    this.refreshMarkdownPreviews();
    this.refreshToolbars();
  }

  refreshMarkdownPreviews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof obsidian.MarkdownView) {
        leaf.view.previewMode?.rerender(true);
      }
    });
  }

  // ══ Item cache ════════════════════════════════════════════════════════════
  cacheItem(item: ZoteroItem) {
    this.itemCache.set(item.key, item);
    void this.saveSettings();
  }

  getCached(key: string) {
    return this.itemCache.get(key);
  }

  async fetchAndCache(key: string): Promise<ZoteroItem | null> {
    try {
      const map = await this.api.getItemsByKeys([key]);
      const item = map.get(key) ?? null;
      if (item) {
        item.key = key;
        this.cacheItem(item);
      }
      return item;
    } catch (_e) {
      return null;
    }
  }

  // ══ Commands ══════════════════════════════════════════════════════════════
  getEditor(): EditorLike | null {
    return this.app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor ?? null;
  }

  getInputFilePath(): string | null {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;

    const base = this.app.vault.adapter instanceof obsidian.FileSystemAdapter
      ? this.app.vault.adapter.getBasePath()
      : null;
    return base ? `${base}/${file.path}` : file.path;
  }

  captureEditorSelection(editor: EditorLike): SelectionSnapshot {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    return { from, to };
  }

  getEditorForInsertion(fallbackEditor: EditorLike, sourcePath: string | null) {
    const activeView = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    const activeEditor = activeView?.editor;
    const activePath = this.app.workspace.getActiveFile()?.path;
    if (activeEditor && (!sourcePath || activePath === sourcePath)) return activeEditor;
    return fallbackEditor;
  }

  restoreEditorSelection(editor: EditorLike, snapshot?: SelectionSnapshot | null) {
    if (!snapshot) return;
    try {
      editor.setSelection(snapshot.from, snapshot.to);
    } catch (_e) {
      try {
        editor.setCursor(snapshot.to);
      } catch (_e2) {
        // noop
      }
    }
  }

  refocusObsidianWindow(editor?: EditorLike | null) {
    const focusEditor = () => {
      try {
        editor?.focus?.();
      } catch (_e) {
        // noop
      }
      try {
        editor?.cm?.focus?.();
      } catch (_e) {
        // noop
      }
    };

    const attempt = () => {
      try {
        const remote = require("@electron/remote");
        const win = remote?.getCurrentWindow?.();
        const appName = remote?.app?.getName?.();

        try {
          if (win?.isMinimized?.()) win.restore?.();
        } catch (_e) {
          // noop
        }
        try {
          win?.show?.();
        } catch (_e) {
          // noop
        }
        try {
          win?.focus?.();
        } catch (_e) {
          // noop
        }
        try {
          win?.moveTop?.();
        } catch (_e) {
          // noop
        }
        try {
          remote?.app?.focus?.({ steal: true });
        } catch (_e) {
          try {
            remote?.app?.focus?.();
          } catch (_e2) {
            // noop
          }
        }
        try {
          if (obsidian.Platform.isMacOS) {
            const { execFile } = require("child_process");
            execFile(
              "osascript",
              ["-e", `tell application "${String(appName || "Obsidian").replace(/"/g, '\\"')}" to activate`],
              () => {
                // noop
              },
            );
          }
        } catch (_e) {
          // noop
        }
      } catch (_e) {
        try {
          const electron = require("electron");
          const win = electron.remote?.getCurrentWindow?.();
          try {
            if (win?.isMinimized?.()) win.restore?.();
          } catch (_e2) {
            // noop
          }
          try {
            win?.focus?.();
          } catch (_e2) {
            // noop
          }
        } catch (_e2) {
          // noop
        }
      }

      try {
        window.focus();
      } catch (_e) {
        // noop
      }
      try {
        (this.app as AppWithCommands).commands?.executeCommandById?.("editor:focus");
      } catch (_e) {
        // noop
      }
      focusEditor();
    };

    if (this.focusBurstTimer) {
      window.clearInterval(this.focusBurstTimer);
      this.focusBurstTimer = null;
    }
    if (this.focusBurstStopTimer) {
      window.clearTimeout(this.focusBurstStopTimer);
      this.focusBurstStopTimer = null;
    }
    if (this.focusBurstTopmostResetTimer) {
      window.clearTimeout(this.focusBurstTopmostResetTimer);
      this.focusBurstTopmostResetTimer = null;
    }

    let win: any = null;
    try {
      const remote = require("@electron/remote");
      win = remote?.getCurrentWindow?.();
      try {
        win?.setAlwaysOnTop?.(true);
      } catch (_e) {
        // noop
      }
    } catch (_e) {
      // noop
    }

    attempt();
    this.focusBurstTimer = window.setInterval(attempt, 40);
    this.focusBurstStopTimer = window.setTimeout(() => {
      if (this.focusBurstTimer) {
        window.clearInterval(this.focusBurstTimer);
        this.focusBurstTimer = null;
      }
      this.focusBurstStopTimer = null;
    }, 1200);
    this.focusBurstTopmostResetTimer = window.setTimeout(() => {
      try {
        win?.setAlwaysOnTop?.(false);
      } catch (_e) {
        // noop
      }
      this.focusBurstTopmostResetTimer = null;
    }, 1400);
  }

  // ── Insert / Edit citation (uses Zotero native CAYW picker) ──────────────
  async insertOrEditCitation(editor: EditorLike) {
    const content = editor.getValue();
    const pos = editor.posToOffset(editor.getCursor());
    const existingInline = CitationManager.isInsideInline(content, pos);
    const existingEndnote = CitationManager.isInsideEndnoteRef(content, pos);
    const existingInText = CitationManager.isInsideInText(content, pos);
    const sourcePath = this.app.workspace.getActiveFile()?.path || null;
    const selectionSnapshot = this.captureEditorSelection(editor);
    const notice = new obsidian.Notice(this.t("notice.openPicker"), 0);

    let items: CaywResult[];
    try {
      items = await this.api.openCAYW(() => this.refocusObsidianWindow(this.getEditorForInsertion(editor, sourcePath)));
    } catch (err) {
      notice.hide();
      this.refocusObsidianWindow(this.getEditorForInsertion(editor, sourcePath));

      if (err instanceof ZoteroConnectionError) {
        new obsidian.Notice(this.t("notice.connectZoteroFailed"), 6000);
      } else if (err instanceof ZoteroPickerError) {
        new obsidian.Notice(this.t("notice.nativePickerFallback"), 5000);
        this.openSearchFallback(
          editor,
          existingInline?.page,
          existingEndnote?.page,
          existingInText?.page,
          existingInline,
          existingEndnote,
          existingInText,
        );
      } else {
        new obsidian.Notice(this.t("notice.pickerError", { error: String(err) }), 6000);
      }
      return;
    }

    notice.hide();
    const targetEditor = this.getEditorForInsertion(editor, sourcePath);
    if (!items.length) {
      this.refocusObsidianWindow(targetEditor);
      return;
    }

    for (const ci of items) this.cacheItem(ci.item);
    this.restoreEditorSelection(targetEditor, selectionSnapshot);
    this.applySelectedCitations(targetEditor, items, existingInline, existingEndnote, existingInText);
    this.refocusObsidianWindow(targetEditor);
  }

  // ── Toggle Word-style display ─────────────────────────────────────────────
  toggleWordDisplay() {
    this.settings.showWordStyleFootnotes = !this.settings.showWordStyleFootnotes;
    void this.saveSettings();
    this.refreshEditorExtension();
    new obsidian.Notice(
      this.settings.showWordStyleFootnotes ? this.t("notice.wordDisplayOn") : this.t("notice.wordDisplayOff"),
    );
  }

  // ── Insert bibliography ───────────────────────────────────────────────────
  async insertBibliography(editor: EditorLike) {
    const content = editor.getValue();
    const all = CitationManager.parseAllCitations(content);
    if (!all.length) {
      new obsidian.Notice(this.t("notice.noManagedCitations"));
      return;
    }

    const keys = [...new Set(all.map((c) => c.key))];
    const itemMap = await this.resolveItems(keys);
    if (!itemMap) return;

    const bib = CitationManager.generateBibliography(
      content,
      itemMap,
      this.settings.cslStyle,
      this.t("bibliography.heading"),
    );
    if (!bib) {
      new obsidian.Notice(this.t("notice.noBibliography"));
      return;
    }

    CitationManager.insertOrReplaceBibliography(editor, bib);
    new obsidian.Notice(this.t("notice.bibliographyUpdated"));
  }

  // ── Refresh all ───────────────────────────────────────────────────────────
  async refreshAll(editor: EditorLike) {
    const removedOrphans = CitationManager.removeUnreferencedEndnotes(editor);
    const content = editor.getValue();
    const all = CitationManager.parseAllCitations(content);

    if (!all.length) {
      const removedBib = CitationManager.removeManagedBibliography(editor);
      if (removedOrphans || removedBib) {
        new obsidian.Notice(
          this.t("notice.cleanedOrphans", {
            count: removedOrphans,
            extra: removedBib ? this.t("notice.cleanedOrphans.extraBib") : "",
          }),
        );
      } else {
        new obsidian.Notice(this.t("notice.noManagedCitations"));
      }
      return;
    }

    const notice = new obsidian.Notice(this.t("notice.refreshing"), 0);
    try {
      const keys = [...new Set(all.map((c) => c.key))];
      const fetched = await this.api.getItemsByKeys(keys);
      for (const [k, v] of fetched) this.cacheItem(v.key ? v : { ...v, key: k });

      const itemMap = new Map<string, ZoteroItem>();
      for (const key of keys) {
        const item = fetched.get(key) ?? this.getCached(key);
        if (item) itemMap.set(key, item);
      }

      notice.hide();
      const style = this.settings.cslStyle;
      let count = 0;
      count += CitationManager.refreshInline(editor, itemMap, style);
      count += CitationManager.refreshEndnotes(editor, itemMap, style);
      count += CitationManager.refreshInText(editor, itemMap, style);

      const newContent = editor.getValue();
      if (newContent.includes("<!-- zotero-bibliography-start -->")) {
        const existingHeading = CitationManager.extractBibHeading(newContent);
        const bib = CitationManager.generateBibliography(
          newContent,
          itemMap,
          style,
          existingHeading || this.t("bibliography.heading"),
        );
        CitationManager.insertOrReplaceBibliography(editor, bib);
      }

      const extra = removedOrphans ? this.t("notice.refreshed.extraOrphans", { count: removedOrphans }) : "";
      new obsidian.Notice(this.t("notice.refreshed", { count, extra }));
    } catch (err) {
      notice.hide();
      if (err instanceof ZoteroConnectionError) {
        new obsidian.Notice(this.t("notice.zoteroUnavailable"), 5000);
      } else {
        new obsidian.Notice(this.t("notice.refreshFailed", { error: String(err) }), 5000);
      }
    }
  }

  // ── Export to Word ────────────────────────────────────────────────────────
  async exportToWord() {
    const inputPath = this.getInputFilePath();
    if (!inputPath) {
      new obsidian.Notice(this.t("notice.openFileBeforeExport"));
      return;
    }

    const suggested = ExportManager.suggestOutputPath(inputPath, this.settings);
    if (this.settings.useDefaultExportDir) {
      await this.doExport(inputPath, suggested);
    } else {
      const chosen = await ExportManager.showNativeSaveDialog(suggested, this.settings);
      if (chosen === null) return;
      if (chosen) {
        await this.doExport(inputPath, chosen);
      } else {
        new ExportModal(this.app, suggested, async (outputPath) => {
          await this.doExport(inputPath, outputPath);
        }).open();
      }
    }
  }

  async doExport(inputPath: string, outputPath: string) {
    const notice = new obsidian.Notice(this.t("notice.exporting"), 0);
    try {
      await ExportManager.exportToWord(inputPath, outputPath, this.settings);
      notice.hide();
      new obsidian.Notice(this.t("notice.exportSuccess", { path: outputPath }), 8000);
    } catch (err) {
      notice.hide();
      new obsidian.Notice(String(err), 10000);
    }
  }

  // ── Unlink citations ──────────────────────────────────────────────────────
  unlinkCitations(editor: EditorLike) {
    const inlines = CitationManager.parseInlineCitations(editor.getValue()).length;
    const endnotes = CitationManager.parseEndnoteDefs(editor.getValue()).length;
    const inText = CitationManager.parseInTextCitations(editor.getValue()).length;
    const total = inlines + endnotes + inText;

    if (!total) {
      new obsidian.Notice(this.t("notice.noManagedCitations"));
      return;
    }

    new ConfirmModal(
      this.app,
      this.t("unlink.title"),
      this.t("unlink.message", { total, inline: inlines, endnote: endnotes, intext: inText }),
      () => {
        const count = CitationManager.unlinkAll(editor);
        new obsidian.Notice(this.t("unlink.done", { count }));
      },
      "zotero-unlink-modal",
    ).open();
  }

  // ── Document preferences ──────────────────────────────────────────────────
  openPreferences() {
    new PreferencesModal(this.app, {
      api: this.api,
      currentStyle: this.settings.cslStyle,
      currentMode: this.settings.citationMode,
      onStyleChange: async (s) => {
        this.settings.cslStyle = s;
        await this.saveSettings();
      },
      onModeChange: async (m) => {
        this.settings.citationMode = m;
        await this.saveSettings();
      },
      refreshEditorExtension: () => this.refreshEditorExtension(),
      getEditor: () => this.getEditor(),
      getItemFromCache: (k) => this.getCached(k),
      fetchAndCacheItem: (k) => this.fetchAndCache(k),
    }).open();
  }

  openSearchFallback(
    editor: EditorLike,
    existingInlinePage?: string,
    existingEndnotePage?: string,
    existingInTextPage?: string,
    existingInline: InlineCitation | null = CitationManager.isInsideInline(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
    existingEndnote: EndnoteDef | null = CitationManager.isInsideEndnoteRef(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
    existingInText: InTextCitation | null = CitationManager.isInsideInText(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
  ) {
    const existingPage = existingInlinePage || existingEndnotePage || existingInTextPage;
    new SearchModal(this.app, {
      api: this.api,
      style: this.settings.cslStyle,
      existingPage: this.toEditableLocator(existingPage),
      onConfirm: (item, page) => {
        this.cacheItem(item);
        this.applySelectedCitations(
          editor,
          [{ item, locator: page || undefined, locatorLabel: "page" }],
          existingInline,
          existingEndnote,
          existingInText,
        );
      },
    }).open();
  }

  applySelectedCitations(
    editor: EditorLike,
    items: CaywResult[],
    existingInline: InlineCitation | null = CitationManager.isInsideInline(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
    existingEndnote: EndnoteDef | null = CitationManager.isInsideEndnoteRef(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
    existingInText: InTextCitation | null = CitationManager.isInsideInText(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
  ) {
    const style = this.settings.cslStyle;
    const mode = this.settings.citationMode;

    if (items.length === 1) {
      const ci = items[0];
      const page = formatLocator(ci.locator, ci.locatorLabel) || undefined;

      if (existingInline) {
        CitationManager.replaceInline(editor, existingInline, ci.item, style, page);
        new obsidian.Notice(this.t("notice.citationUpdated"));
        return;
      }
      if (existingEndnote) {
        CitationManager.replaceEndnoteDef(editor, existingEndnote, ci.item, style, page);
        new obsidian.Notice(this.t("notice.citationUpdated"));
        return;
      }
      if (existingInText) {
        CitationManager.replaceInText(editor, existingInText, ci.item, style, page);
        new obsidian.Notice(this.t("notice.citationUpdated"));
        return;
      }
    }

    for (const ci of items) {
      const page = formatLocator(ci.locator, ci.locatorLabel) || undefined;
      if (mode === "inline") {
        CitationManager.insertInline(editor, ci.item, style, page);
      } else if (mode === "intext") {
        CitationManager.insertInText(editor, ci.item, style, page);
      } else {
        CitationManager.insertEndnote(editor, ci.item, style, page);
      }
    }

    new obsidian.Notice(this.t("notice.insertedCitations", { count: items.length }));
  }

  // ── Shared helper ─────────────────────────────────────────────────────────
  async resolveItems(keys: string[]): Promise<Map<string, ZoteroItem> | null> {
    const map = new Map<string, ZoteroItem>();
    const missing: string[] = [];

    for (const k of keys) {
      const c = this.getCached(k);
      if (c) map.set(k, c);
      else missing.push(k);
    }

    if (missing.length) {
      const n = new obsidian.Notice(this.t("notice.fetchingItems", { count: missing.length }), 0);
      try {
        for (const k of missing) {
          const item = await this.fetchAndCache(k);
          if (item) map.set(k, item);
        }
      } catch (err) {
        n.hide();
        if (err instanceof ZoteroConnectionError) {
          new obsidian.Notice(this.t("notice.zoteroUnavailable"), 5000);
        } else {
          new obsidian.Notice(this.t("notice.fetchItemsFailed", { error: String(err) }), 5000);
        }
        return null;
      }
      n.hide();
    }

    return map;
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  /** Public so settings tab can call it. */
  refreshToolbars() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof obsidian.MarkdownView) {
        this.syncToolbar(leaf.view);
      }
    });
  }

  toggleToolbar() {
    this.settings.showToolbar = !this.settings.showToolbar;
    void this.saveSettings();
    this.refreshToolbars();
    new obsidian.Notice(this.settings.showToolbar ? this.t("notice.toolbarShown") : this.t("notice.toolbarHidden"));
  }

  syncToolbar(view: obsidian.MarkdownView) {
    this.clearToolbar(view);
    if (!this.settings.showToolbar) return;

    const btns = this.settings.toolbarButtons || {};
    const actionEls: HTMLElement[] = [];
    const action = (icon: string, title: string, cb: () => void, active = false) => {
      const el = view.addAction(icon, title, (evt: Event) => {
        evt.preventDefault();
        evt.stopPropagation();
        cb();
      }) as HTMLElement;
      el.classList.add("zotero-titlebar-action");
      if (active) el.classList.add("is-active");
      actionEls.push(el);
    };

    if (btns.export !== false) action("zotero-export", this.t("toolbar.export"), () => this.exportToWord());
    if (btns.unlink !== false) action("zotero-unlink", this.t("toolbar.unlink"), () => {
      const ed = view.editor;
      if (ed) this.unlinkCitations(ed);
    });
    if (btns.changeStyle !== false) action("zotero-style", this.t("toolbar.changeStyle"), () => this.openPreferences());
    if (btns.refresh !== false) action("zotero-refresh", this.t("toolbar.refresh"), () => {
      const ed = view.editor;
      if (ed) this.refreshAll(ed);
    });
    if (btns.wordDisplay !== false) {
      action(
        "zotero-word-display",
        this.t("toolbar.wordDisplay"),
        () => this.toggleWordDisplay(),
        this.settings.showWordStyleFootnotes,
      );
    }
    if (btns.insertCitation !== false) action("zotero-cite", this.t("toolbar.insertCitation"), () => {
      const ed = view.editor;
      if (ed) this.insertOrEditCitation(ed);
    });

    this.titlebarActions.set(view, actionEls);
  }

  clearToolbar(view: obsidian.MarkdownView) {
    view.contentEl.querySelectorAll(".zotero-toolbar").forEach((el: Element) => el.remove());
    const actionEls = this.titlebarActions.get(view);
    if (!actionEls) return;
    for (const el of actionEls) el.remove();
    this.titlebarActions.delete(view);
  }

  decorateRenderedFootnotes(root: HTMLElement) {
    if (!this.settings.showWordStyleFootnotes) return;
    const refs = root.querySelectorAll("a.footnote-ref, a[data-footnote-ref]");
    refs.forEach((refEl) => {
      const ref = refEl as HTMLAnchorElement;
      const marker = this.getRenderedFootnoteMarker(ref);
      if (marker) ref.textContent = marker;
      ref.classList.add("zotero-rendered-footnote-ref");
      ref.parentElement?.classList.add("zotero-rendered-footnote-sup");
      const tooltip = this.getRenderedFootnoteTooltip(ref, root);
      ref.removeAttribute("title");
      if (!tooltip) return;
      ref.removeAttribute("aria-label");
    });
  }

  getRenderedFootnoteMarker(ref: HTMLAnchorElement) {
    const text = ref.textContent?.trim() ?? "";
    const fromText = text.match(/\d+/)?.[0];
    if (fromText) return fromText;
    const href = ref.getAttribute("href") ?? "";
    return href.match(/\d+/)?.[0] ?? text.replace(/^\[|\]$/g, "");
  }

  getRenderedFootnoteTooltip(ref: HTMLAnchorElement, root: ParentNode) {
    const href = ref.getAttribute("href");
    if (!href?.startsWith("#")) return "";

    const targetId = decodeURIComponent(href.slice(1));
    const noteEl = this.findById(root, targetId) ?? ref.ownerDocument?.getElementById(targetId);
    if (!noteEl) return "";

    const cloned = noteEl.cloneNode(true) as HTMLElement;
    cloned
      .querySelectorAll('a.footnote-backref, a[data-footnote-backref], a[href^="#fnref"]')
      .forEach((el) => el.remove());
    return this.normalizeFootnoteText(cloned.textContent ?? "");
  }

  findById(root: ParentNode, id: string): HTMLElement | null {
    if (!id) return null;
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return root.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    }
    return root.querySelector(`[id="${id.replace(/"/g, '\\"')}"]`) as HTMLElement | null;
  }

  normalizeFootnoteText(text: string) {
    return text.replace(/\s+/g, " ").trim();
  }

  toEditableLocator(locator?: string) {
    if (!locator) return locator;
    return locator.replace(/^(p\.|para\.|sec\.|ch\.|fig\.|table|v\.|l\.|n\.|col\.|no\.|vol\.)\s+/i, "");
  }
}

class ConfirmModal extends obsidian.Modal {
  title: string;
  msg: string;
  cb: () => void;
  cls?: string;

  constructor(app: obsidian.App, title: string, msg: string, cb: () => void, cls?: string) {
    super(app);
    this.title = title;
    this.msg = msg;
    this.cb = cb;
    this.cls = cls;
  }

  onOpen() {
    if (this.cls) this.contentEl.addClass(this.cls);
    this.contentEl.createEl("h2", { text: this.title, cls: "zotero-modal-title" });
    this.contentEl.createEl("p", { text: this.msg });
    const row = this.contentEl.createDiv({ cls: "zotero-btn-row" });
    row.createEl("button", { text: appT(this.app, "common.cancel") }).addEventListener("click", () => this.close());
    const ok = row.createEl("button", { text: appT(this.app, "common.confirm"), cls: "mod-warning" });
    ok.addEventListener("click", () => {
      this.cb();
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
