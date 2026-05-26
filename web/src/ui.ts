import type { CatalogProduct, PlacedItem, RoomDims } from "./types.js";

export type UICallbacks = {
  onRoomChange: (dims: RoomDims) => void;
  onProductPick: (product: CatalogProduct) => void;
  onRotate: () => void;
  onDelete: () => void;
  onClearLayout: () => void;
  onCopyShareLink: () => void;
  onExportPNG: () => void;
};

export type UIRefs = {
  canvasContainer: HTMLDivElement;
  status: HTMLSpanElement;
};

export function buildUI(root: HTMLElement, callbacks: UICallbacks): UIRefs {
  root.classList.add("qhf-rp");
  root.innerHTML = "";

  // Header.
  const header = el("header", "qhf-rp__header");
  header.innerHTML = `<h2>Plan Your Room</h2><p>Drag furniture to scale. Click items to rotate or remove.</p>`;
  root.appendChild(header);

  // Room dimension form.
  const room = el("section", "qhf-rp__room");
  const widthField = makeFtInField("Room width");
  const depthField = makeFtInField("Room depth");
  const applyBtn = el<HTMLButtonElement>("button", "qhf-rp__btn qhf-rp__btn--primary");
  applyBtn.type = "button";
  applyBtn.textContent = "Apply room size";
  room.append(widthField.wrap, depthField.wrap, applyBtn);
  root.appendChild(room);

  // Palette.
  const palette = el("aside", "qhf-rp__palette");
  const searchWrap = el("div", "qhf-rp__palette-search");
  const search = el<HTMLInputElement>("input", "");
  search.type = "search";
  search.placeholder = "Search furniture…";
  searchWrap.appendChild(search);
  const list = el("div", "qhf-rp__palette-list");
  list.appendChild(buildEmpty("Loading products…"));
  palette.append(searchWrap, list);
  root.appendChild(palette);

  // Canvas.
  const canvasWrap = el("div", "qhf-rp__canvas-wrap");
  const canvasContainer = el<HTMLDivElement>("div", "qhf-rp__canvas");
  canvasWrap.appendChild(canvasContainer);
  root.appendChild(canvasWrap);

  // Footer / selection toolbar.
  const footer = el("footer", "qhf-rp__footer");
  const status = el<HTMLSpanElement>("span", "qhf-rp__footer-status");
  status.textContent = "Set your room size to begin.";
  const rotateBtn = makeFooterBtn("Rotate 90°");
  const deleteBtn = makeFooterBtn("Delete", "qhf-rp__btn--danger");
  const clearBtn = makeFooterBtn("Clear layout");
  const shareBtn = makeFooterBtn("Copy share link", "qhf-rp__btn--primary");
  const exportBtn = makeFooterBtn("Save as image");
  rotateBtn.disabled = true;
  deleteBtn.disabled = true;
  footer.append(status, rotateBtn, deleteBtn, clearBtn, shareBtn, exportBtn);
  root.appendChild(footer);

  // Internal state for palette filtering.
  const products: CatalogProduct[] = [];
  let filter = "";
  let initialized = false;

  function renderPalette() {
    const f = filter.trim().toLowerCase();
    const items = f ? products.filter((p) => p.title.toLowerCase().includes(f)) : products;
    list.innerHTML = "";
    if (products.length === 0) {
      list.appendChild(buildEmpty("No products available yet."));
      return;
    }
    if (items.length === 0) {
      list.appendChild(buildEmpty("No matches."));
      return;
    }
    for (const product of items.slice(0, 200)) {
      list.appendChild(buildPaletteItem(product, callbacks.onProductPick));
    }
    if (items.length > 200) {
      const more = el("div", "qhf-rp__palette-empty");
      more.textContent = `Showing first 200 of ${items.length} — narrow the search.`;
      list.appendChild(more);
    }
  }

  // Wire events.
  applyBtn.addEventListener("click", () => {
    const widthIn = widthField.read();
    const depthIn = depthField.read();
    if (widthIn <= 0 || depthIn <= 0) {
      status.textContent = "Enter a room width and depth greater than zero.";
      return;
    }
    if (widthIn > 100 * 12 || depthIn > 100 * 12) {
      status.textContent = "Room dimensions over 100 ft aren't supported.";
      return;
    }
    callbacks.onRoomChange({ widthIn, depthIn });
    status.textContent = `Room set to ${fmtFtIn(widthIn)} × ${fmtFtIn(depthIn)}.`;
    initialized = true;
  });
  search.addEventListener("input", () => {
    filter = search.value;
    renderPalette();
  });
  rotateBtn.addEventListener("click", () => callbacks.onRotate());
  deleteBtn.addEventListener("click", () => callbacks.onDelete());
  clearBtn.addEventListener("click", () => {
    if (confirm("Remove all items from the room?")) callbacks.onClearLayout();
  });
  shareBtn.addEventListener("click", () => callbacks.onCopyShareLink());
  exportBtn.addEventListener("click", () => callbacks.onExportPNG());

  return {
    canvasContainer,
    status,
    // Exposed helpers attached via Object.assign so the caller has access without ceremony.
    ...({
      setProducts(next: CatalogProduct[]) {
        products.length = 0;
        products.push(...next);
        renderPalette();
      },
      appendProducts(next: CatalogProduct[]) {
        products.push(...next);
        renderPalette();
      },
      setRoomInputs(dims: RoomDims) {
        widthField.set(dims.widthIn);
        depthField.set(dims.depthIn);
        initialized = true;
      },
      setSelection(item: PlacedItem | null) {
        rotateBtn.disabled = !item;
        deleteBtn.disabled = !item;
        if (item) {
          status.textContent = `Selected: ${item.title} (${fmtIn(item.widthIn)} × ${fmtIn(item.depthIn)}).`;
        } else if (initialized) {
          status.textContent = "Click an item to select it.";
        }
      },
      setStatus(text: string) {
        status.textContent = text;
      },
    } as Record<string, unknown>),
  } as UIRefs & {
    setProducts(next: CatalogProduct[]): void;
    appendProducts(next: CatalogProduct[]): void;
    setRoomInputs(dims: RoomDims): void;
    setSelection(item: PlacedItem | null): void;
    setStatus(text: string): void;
  };
}

function el<T extends HTMLElement = HTMLElement>(tag: string, className: string): T {
  const e = document.createElement(tag) as T;
  if (className) e.className = className;
  return e;
}

function buildEmpty(text: string): HTMLElement {
  const e = el("div", "qhf-rp__palette-empty");
  e.textContent = text;
  return e;
}

function buildPaletteItem(product: CatalogProduct, onPick: (p: CatalogProduct) => void): HTMLElement {
  const item = el("div", "qhf-rp__palette-item");
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.src = product.imageUrl ?? transparentPixel();
  item.appendChild(img);
  const info = el("div", "qhf-rp__palette-item-info");
  const title = el("div", "qhf-rp__palette-item-title");
  title.textContent = product.title;
  const dims = el("div", "qhf-rp__palette-item-dims");
  dims.textContent = `${fmtIn(product.widthIn)} W × ${fmtIn(product.depthIn)} D`;
  info.append(title, dims);
  item.appendChild(info);
  item.addEventListener("click", () => onPick(product));
  return item;
}

function makeFooterBtn(text: string, extra = ""): HTMLButtonElement {
  const b = el<HTMLButtonElement>("button", `qhf-rp__btn ${extra}`.trim());
  b.type = "button";
  b.textContent = text;
  return b;
}

function makeFtInField(label: string): {
  wrap: HTMLElement;
  read: () => number;
  set: (totalIn: number) => void;
} {
  const wrap = el("div", "qhf-rp__field");
  const lbl = document.createElement("label");
  lbl.textContent = label;
  const row = el("div", "qhf-rp__field-row");
  const ft = document.createElement("input");
  ft.type = "number";
  ft.min = "0";
  ft.max = "100";
  ft.step = "1";
  ft.value = "12";
  const ftLbl = document.createElement("span");
  ftLbl.textContent = "ft";
  const inEl = document.createElement("input");
  inEl.type = "number";
  inEl.min = "0";
  inEl.max = "11";
  inEl.step = "0.5";
  inEl.value = "0";
  const inLbl = document.createElement("span");
  inLbl.textContent = "in";
  row.append(ft, ftLbl, inEl, inLbl);
  wrap.append(lbl, row);
  return {
    wrap,
    read() {
      const f = Math.max(0, Math.floor(Number(ft.value) || 0));
      const i = Math.max(0, Number(inEl.value) || 0);
      return f * 12 + i;
    },
    set(totalIn: number) {
      const f = Math.floor(totalIn / 12);
      const i = totalIn - f * 12;
      ft.value = String(f);
      inEl.value = String(Number.isInteger(i) ? i : i.toFixed(1));
    },
  };
}

function fmtFtIn(inches: number): string {
  const ft = Math.floor(inches / 12);
  const rem = inches - ft * 12;
  if (rem === 0) return `${ft}'`;
  const s = Number.isInteger(rem) ? `${rem}"` : `${rem.toFixed(1)}"`;
  return `${ft}'${s}`;
}

function fmtIn(inches: number): string {
  return Number.isInteger(inches) ? `${inches}"` : `${inches.toFixed(1)}"`;
}

let _pixel: string | null = null;
function transparentPixel(): string {
  if (_pixel) return _pixel;
  _pixel =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 44'><rect width='44' height='44' fill='#eee'/></svg>`,
    );
  return _pixel;
}
