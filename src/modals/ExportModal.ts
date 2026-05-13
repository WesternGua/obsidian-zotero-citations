/**
 * ExportModal.ts – Path picker modal for Word export
 */
import { Modal, App } from "obsidian";
import { appT } from "../i18n";

export class ExportModal extends Modal {
  private suggestedPath: string;
  private onConfirm: (path: string) => void;
  private input!: HTMLInputElement;

  constructor(app: App, suggestedPath: string, onConfirm: (path: string) => void) {
    super(app);
    this.suggestedPath = suggestedPath;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: appT(this.app, "export.chooseLocation"), cls: "zotero-modal-title" });
    contentEl.createEl("p", {
      text: appT(this.app, "export.pathHint"),
      cls: "zotero-export-hint",
    });

    this.input = contentEl.createEl("input", { type: "text", cls: "zotero-export-input" });
    this.input.value = this.suggestedPath;
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.doConfirm();
      if (e.key === "Escape") this.close();
    });

    const btnRow = contentEl.createDiv({ cls: "zotero-btn-row" });

    const cancel = btnRow.createEl("button", { text: appT(this.app, "common.cancel") });
    cancel.addEventListener("click", () => this.close());

    const confirm = btnRow.createEl("button", { text: appT(this.app, "common.export"), cls: "mod-cta" });
    confirm.addEventListener("click", () => this.doConfirm());

    const win = (window as Window & { activeWindow?: Window }).activeWindow ?? window;
    win.setTimeout(() => {
      this.input.focus();
      this.input.select();
    }, 50);
  }

  private doConfirm(): void {
    const p = this.input.value.trim();
    if (!p) return;
    this.close();
    this.onConfirm(p);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
