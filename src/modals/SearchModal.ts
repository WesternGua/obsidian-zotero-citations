/**
 * SearchModal.ts – In-plugin citation search fallback
 */
import { Modal, App } from "obsidian";
import { Language, appT, getAppSettings } from "../i18n";
import { ZoteroAPI, ZoteroItem, ZoteroConnectionError } from "../ZoteroAPI";
import { CitationManager } from "../CitationManager";
import { DEFAULT_SETTINGS, getStyleName, getItemTypeLabel } from "../settings";

export interface SearchModalOpts {
  api: ZoteroAPI;
  style: string;
  existingPage?: string;
  onConfirm: (item: ZoteroItem, page: string) => void;
}

export class SearchModal extends Modal {
  private opts: SearchModalOpts;
  private selectedItem: ZoteroItem | null = null;
  private debounceTimer: number | null = null;
  private searchInput!: HTMLInputElement;
  private resultsEl!: HTMLElement;
  private pageInput!: HTMLInputElement;
  private confirmBtn!: HTMLButtonElement;

  private _pageChangeHandler = () => {
    if (!this.selectedItem) return;
    const previewEl = this.contentEl.querySelector<HTMLElement>(".zotero-preview");
    if (!previewEl) return;
    const preview = CitationManager.formatCitation(
      this.selectedItem,
      this.opts.style,
      this.pageInput.value.trim() || undefined
    );
    previewEl.setText(appT(this.app, "search.preview", { preview }));
  };

  constructor(app: App, opts: SearchModalOpts) {
    super(app);
    this.opts = opts;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("zotero-search-modal");
    contentEl.createEl("h2", { text: appT(this.app, "search.title"), cls: "zotero-modal-title" });

    const styleName = getStyleName(this.opts.style, getAppSettings(this.app) || DEFAULT_SETTINGS);
    contentEl.createEl("p", {
      text: appT(this.app, "search.currentStyle", { style: styleName }),
      cls: "zotero-style-hint",
    });

    const searchWrap = contentEl.createDiv({ cls: "zotero-search-wrap" });
    this.searchInput = searchWrap.createEl("input", {
      type: "text",
      placeholder: appT(this.app, "search.placeholder"),
      cls: "zotero-search-input",
    });
    this.searchInput.addEventListener("input", () => this.onSearchInput());

    this.resultsEl = contentEl.createDiv({ cls: "zotero-results" });
    this.resultsEl.createEl("p", {
      text: appT(this.app, "search.enterQuery"),
      cls: "zotero-results-placeholder",
    });

    const pageWrap = contentEl.createDiv({ cls: "zotero-page-wrap" });
    pageWrap.createEl("label", { text: appT(this.app, "search.pageLabel") });
    this.pageInput = pageWrap.createEl("input", {
      type: "text",
      placeholder: appT(this.app, "search.pagePlaceholder"),
      cls: "zotero-page-input",
    });
    if (this.opts.existingPage) this.pageInput.value = this.opts.existingPage;

    const btnRow = contentEl.createDiv({ cls: "zotero-btn-row" });

    const cancelBtn = btnRow.createEl("button", { text: appT(this.app, "common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());

    this.confirmBtn = btnRow.createEl("button", { text: appT(this.app, "search.confirm"), cls: "mod-cta" });
    this.confirmBtn.disabled = true;
    this.confirmBtn.addEventListener("click", () => this.confirm());

    this.contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !this.confirmBtn.disabled) this.confirm();
      if (e.key === "Escape") this.close();
    });

    const win = (window as Window & { activeWindow?: Window }).activeWindow ?? window;
    win.setTimeout(() => { this.searchInput.focus(); }, 50);
  }

  private onSearchInput(): void {
    const win = (window as Window & { activeWindow?: Window }).activeWindow ?? window;
    if (this.debounceTimer) win.clearTimeout(this.debounceTimer);
    const q = this.searchInput.value.trim();
    if (!q) {
      this.resultsEl.empty();
      this.resultsEl.createEl("p", { text: appT(this.app, "search.enterQuery"), cls: "zotero-results-placeholder" });
      return;
    }
    this.debounceTimer = win.setTimeout(() => { void this.doSearch(q); }, 300);
  }

  private async doSearch(query: string): Promise<void> {
    this.resultsEl.empty();
    const spinner = this.resultsEl.createEl("p", { text: appT(this.app, "search.searching"), cls: "zotero-spinner" });
    try {
      const items = await this.opts.api.searchItems(query);
      spinner.remove();
      if (!items.length) {
        this.resultsEl.createEl("p", { text: appT(this.app, "search.noResults"), cls: "zotero-results-placeholder" });
        return;
      }
      for (const item of items.slice(0, 50)) {
        this.renderResultItem(item);
      }
    } catch (err) {
      spinner.remove();
      if (err instanceof ZoteroConnectionError) {
        this.resultsEl.createEl("p", { text: appT(this.app, "search.connectionError"), cls: "zotero-error" });
      } else {
        this.resultsEl.createEl("p", { text: appT(this.app, "search.failed", { error: String(err) }), cls: "zotero-error" });
      }
    }
  }

  private renderResultItem(item: ZoteroItem): void {
    const row = this.resultsEl.createDiv({ cls: "zotero-result-row" });

    const authors = item.creators
      .filter((c) => c.creatorType === "author")
      .slice(0, 2)
      .map((c) => c.lastName ?? c.name ?? "")
      .filter(Boolean)
      .join(", ");
    const year = CitationManager.getYear(item);
    const typeLabel = SearchModal.typeLabel(item.itemType, getAppSettings(this.app) || DEFAULT_SETTINGS);

    row.createDiv({ text: item.title, cls: "zotero-result-title" });
    row.createDiv({
      text: `${authors}${authors ? " · " : ""}${year} · ${typeLabel}`,
      cls: "zotero-result-meta",
    });

    row.addEventListener("click", () => this.selectItem(item, row));
  }

  private selectItem(item: ZoteroItem, rowEl: HTMLElement): void {
    this.resultsEl.querySelectorAll(".zotero-result-row").forEach((el: Element) => {
      (el as HTMLElement).removeClass("is-selected");
    });
    rowEl.addClass("is-selected");
    this.selectedItem = item;
    this.confirmBtn.disabled = false;

    const preview = CitationManager.formatCitation(
      item,
      this.opts.style,
      this.pageInput.value.trim() || undefined
    );

    let previewEl = this.contentEl.querySelector<HTMLElement>(".zotero-preview");
    if (!previewEl) {
      previewEl = this.contentEl.createDiv({ cls: "zotero-preview" });
    }
    previewEl.setText(appT(this.app, "search.preview", { preview }));

    const btnRow = this.contentEl.querySelector(".zotero-btn-row");
    if (btnRow) this.contentEl.insertBefore(previewEl, btnRow);

    this.pageInput.removeEventListener("input", this._pageChangeHandler);
    this.pageInput.addEventListener("input", this._pageChangeHandler);
  }

  private confirm(): void {
    if (!this.selectedItem) return;
    this.opts.onConfirm(this.selectedItem, this.pageInput.value.trim());
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.debounceTimer) {
      const win = (window as Window & { activeWindow?: Window }).activeWindow ?? window;
      win.clearTimeout(this.debounceTimer);
    }
  }

  static typeLabel(itemType: string, settings: { language?: string } | Language = DEFAULT_SETTINGS): string {
    const label = getItemTypeLabel(itemType, settings);
    return label === `itemType.${itemType}` ? itemType : label;
  }
}
