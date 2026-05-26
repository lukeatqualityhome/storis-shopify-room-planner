import "./styles.css";
import { Planner } from "./planner.js";
import { StorefrontClient } from "./storefront.js";
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
  const shopDomain = el.dataset.shopDomain;
  const storefrontToken = el.dataset.storefrontToken;
  const apiVersion = el.dataset.apiVersion ?? "2025-01";
  if (!shopDomain || !storefrontToken || storefrontToken.startsWith("REPLACE_")) {
    throw new Error(
      "QHF Room Planner: mount element is missing data-shop-domain or data-storefront-token attributes.",
    );
  }
  return { shopDomain, storefrontToken, apiVersion };
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
  }) as FullUI;

  const planner = new Planner(ui.canvasContainer, {
    onChange: (state) => {
      saveLocal(state);
      writeHash(state);
    },
    onSelectionChange: (item) => ui.setSelection(item),
  });

  // Load saved layout (URL hash wins over localStorage).
  const restored = readHash() ?? loadLocal();
  if (restored) {
    planner.loadState(restored);
    ui.setRoomInputs(restored.room);
    ui.setStatus(`Restored layout (${restored.items.length} items).`);
  } else {
    planner.setRoom({ widthIn: 144, depthIn: 120 });
    ui.setRoomInputs({ widthIn: 144, depthIn: 120 });
  }

  // Keyboard shortcuts.
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

  // Stream products into the palette progressively.
  const client = new StorefrontClient(cfg);
  loadProducts(client, ui).catch((err) => {
    console.error("[qhf-room-planner] product load failed", err);
    ui.setStatus(`Product load failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

async function loadProducts(client: StorefrontClient, ui: FullUI): Promise<void> {
  let count = 0;
  ui.setProducts([]);
  for await (const batch of client.iteratePlanReadyProducts()) {
    count += batch.length;
    ui.appendProducts(batch);
    ui.setStatus(`Loaded ${count} furniture pieces…`);
  }
  if (count === 0) {
    ui.setStatus(
      "No products have width/depth metafields yet. Run the STORIS → Shopify sync first.",
    );
  } else {
    ui.setStatus(`Ready. ${count} products available.`);
  }
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
