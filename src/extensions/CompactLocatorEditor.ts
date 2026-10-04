import type { App } from "obsidian";
import { appT } from "../i18n";
import { locatorOptions, parseLocator, serializeLocator } from "../Locator";
import type { CitationEntry } from "../CitationManager";

export interface CompactLocatorOptions {
  app: App;
  entries: CitationEntry[];
  titles: string[];
  save: (locators: string[]) => Promise<boolean>;
  ping: () => Promise<boolean>;
  reposition: () => void;
}

/** Mount controls only on CSL-marked locator variables. Unmarked text is never searched. */
export function mountCompactLocatorEditor(preview: HTMLElement, options: CompactLocatorOptions): void {
  const doc = preview.ownerDocument;
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) if (node.textContent?.includes("\uE000")) nodes.push(node as Text);
  for (const text of nodes) {
    const content = text.data;
    const fragment = doc.createDocumentFragment();
    const pattern = /\uE000zl:(\d+)\uE001([\s\S]*?)\uE000\/zl\uE001|\uE000ze:(\d+)\uE001/g;
    let offset = 0, match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      fragment.append(doc.createTextNode(content.slice(offset, match.index)));
      const span = doc.createElement("span");
      const index = Number(match[1] ?? match[3]);
      if (match[1] !== undefined) {
        span.dataset.zoteroLocator = String(index);
        span.textContent = match[2];
      } else span.dataset.zoteroEntry = String(index);
      fragment.append(span);
      offset = match.index + match[0].length;
    }
    fragment.append(doc.createTextNode(content.slice(offset).replace(/\uE000[^\uE001]*\uE001/g, "")));
    text.replaceWith(fragment);
  }

  const choices = locatorOptions();
  options.entries.forEach((entry, index) => {
    let chips = Array.from(preview.querySelectorAll<HTMLElement>(`[data-zotero-locator="${index}"]`));
    if (!chips.length) {
      const chip = doc.createElement("span");
      chip.dataset.zoteroLocator = String(index);
      const current = parseLocator(entry.page);
      chip.textContent = current.value || appT(options.app, "footnote.addLocator");
      const anchor = preview.querySelector(`[data-zotero-entry="${index}"]`);
      if (anchor) anchor.append(" ", chip);
      else {
        chip.classList.add("zotero-locator-fallback");
        // A title tooltip and occurrence number distinguish style-suppressed locators.
        chip.textContent = `${index + 1} · ${chip.textContent}`;
        preview.append(" ", chip);
      }
      chips = [chip];
    }
    for (const chip of chips) {
      const originalText = chip.textContent || "";
      const title = options.titles[index] || entry.key;
      chip.classList.add("zotero-locator-chip");
      chip.setAttribute("role", "button");
      chip.tabIndex = 0;
      chip.title = title + " — " + appT(options.app, "footnote.locatorHint");
      chip.setAttribute("aria-label", title + " " + appT(options.app, "footnote.locatorHint"));
      let editing = false;
      let saving = false;
      const restore = () => {
        editing = false;
        chip.onkeydown = null;
        chip.classList.remove("is-editing");
        chip.setAttribute("role", "button");
        chip.tabIndex = 0;
        chip.textContent = originalText;
        options.reposition();
      };
      const open = () => {
        if (editing) return;
        editing = true;
        chip.removeAttribute("role");
        chip.tabIndex = -1;
        chip.classList.add("is-editing");
        chip.replaceChildren();
        const locator = parseLocator(entry.page);
        const select = doc.createElement("select");
        select.setAttribute("aria-label", appT(options.app, "footnote.locatorType"));
        for (const choice of choices) {
          const option = doc.createElement("option");
          option.value = choice.value; option.textContent = choice.label;
          select.append(option);
        }
        select.value = locator.label;
        const input = doc.createElement("input");
        input.type = "text"; input.value = locator.value;
        input.placeholder = "5, 5-21";
        input.setAttribute("aria-label", appT(options.app, "footnote.locatorValue"));
        const size = () => { input.style.width = Math.max(3, input.value.length + 2) + "ch"; options.reposition(); };
        size(); input.addEventListener("input", size);
        chip.append(select, input);
        saving = false;
        chip.onkeydown = event => {
          event.stopPropagation();
          if (event.key === "Escape" && !saving) { event.preventDefault(); restore(); return; }
          if (event.key !== "Enter" || saving || event.target === select) return;
          event.preventDefault();
          const values = options.entries.map(e => e.page);
          values[index] = serializeLocator({label:select.value, value:input.value});
          saving = true; select.disabled = input.disabled = true;
          void options.save(values).then(ok => {
            if (ok) { editing = false; return; }
            saving = false; select.disabled = input.disabled = false;
            input.focus({preventScroll:true});
          }).catch(() => { saving = false; select.disabled = input.disabled = false; });
        };
        options.reposition();
        input.focus({preventScroll:true}); input.select();
        void options.ping().then(connected => {
          if (!editing || saving) return;
          if (!connected) {
            select.disabled = input.disabled = true;
            chip.title = appT(options.app, "footnote.zoteroOffline");
          }
        }).catch(() => { if (editing) select.disabled = input.disabled = true; });
      };
      chip.addEventListener("focusout", () => setTimeout(() => {
        if (editing && !saving && !chip.contains(doc.activeElement)) restore();
      }, 0));
      chip.addEventListener("click", event => { event.stopPropagation(); open(); });
      chip.addEventListener("keydown", event => {
        if (!editing && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); open(); }
      });
    }
  });
}
