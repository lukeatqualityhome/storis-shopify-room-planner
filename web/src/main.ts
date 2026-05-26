import "./styles.css";
import { Planner } from "./planner.js";
import { CatalogClient } from "./catalog.js";
import { buildUI } from "./ui.js";
import { loadLocal, readHash, saveLocal, writeHash } from "./state.js";
import type { CatalogProduct, MountConfig } from "./types.js";

const MOUNT_ID = "qhf-room-planner";

type FullUI = ReturnType<typeof buildUI> & {
  setProducts(next: CatalogProduct[]): void;
  appendProducts(next: CatalogProduct[]): void;
  setRoomInputs(dims: { widthIn: number; depthIn: number }): void;
  setSelection(item: import("./types.js").PlacedItem | null): void;
  setStatus(text: string): void;
};

function readMountConfig(el: HTMLElement): MountConfig {
  const catalogUrl = el.dataset.catalogUrl;
  if (!catalogUrl || catalogUrl.startsWith("REPLACE_")) {
    throw new Error(
      "QHF Room Planner: mount element is missing data-catalog-url attribute.",
    );
  }
  return { catalogUrl };
}

function start(): void {
  const mount = document.getElementById(MOUNT_ID);
  if (!mount) {
    console.error(`[qhf-room-planner] mount element #${MOUNT_ID} not found`);
    return;
  }

  let cfg: MountConfig;
  try {
    cfg = readMountConfig(mount);
  } catch (err) {
    mount.textContent = err instanceof Error ? err.message : "Mount config error";
    return;
  }

  const ui = buildUI(mount, {
    onRoomChange: (dims) => planner.setRoom(dims),
    onProductPick: (product) => planner.addItem(product),
    onRotate: () => planner.rotateSelected(),
    onDelete: () => planner.removeSelected(),
    onClearLayout: () => {
      const state = planner.getState();
      planner.loadState({ room: state.room, items: [] });
      ui.setStatus("Layout cleared.");
    },
    onCopyShareLink: async () => {
      writeHash(planner.getState());
      try {
        await navigator.clipboard.writeText(location.href);
        ui.setStatus("Share link copied to clipboard.");
      } catch {
        ui.setStatus(`Copy this URL: ${location.href}`);
      }
    },
    onExportPNG: () => {
      const dataUrl = planner.exportPNG();
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `qhf-room-plan-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      ui.setStatus("Saved your room plan as a PNG.");
    },
  }) as FullUI;

  const planner = new Planner(ui.canvasContainer, {
    onChange: (state) => {
      saveLocal(state);
      writeHash(state);
    },
    onSelectionChange: (item) => ui.setSelection(item),
  });

  const restored = readHash() ?? loadLocal();
  if (restored) {
    planner.loadState(restored);
    ui.setRoomInputs(restored.room);
    ui.setStatus(`Restored layout (${restored.items.length} items).`);
  } else {
    planner.setRoom({ widthIn: 144, depthIn: 120 });
    ui.setRoomInputs({ widthIn: 144, depthIn: 120 });
  }

  document.addEventListener("keydown", (e) => {
    if (isEditingInput(e.target)) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      planner.removeSelected();
      e.preventDefault();
    } else if (e.key === "r" || e.key === "R") {
      planner.rotateSelected();
      e.preventDefault();
    }
  });

  // Load the static JSON catalog and populate the palette in one shot.
  const client = new CatalogClient(cfg);
  client
    .load()
    .then((products) => {
      ui.setProducts(products);
      if (products.length === 0) {
        ui.setStatus(
          "Catalog is empty. Re-run --export-planner-catalog and re-upload room-planner-catalog.json.",
        );
      } else {
        const withImg = products.filter((p) => p.imageUrl).length;
        ui.setStatus(`Ready. ${products.length} products available (${withImg} with photos).`);
      }
    })
    .catch((err) => {
      console.error("[qhf-room-planner] catalog load failed", err);
      ui.setStatus(`Catalog load failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}

function isEditingInput(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
