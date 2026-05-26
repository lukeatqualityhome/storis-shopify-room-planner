import Konva from "konva";
import type { CatalogProduct, LayoutState, PlacedItem, RoomDims } from "./types.js";

const ROOM_PADDING_PX = 24;
const FLOOR_FILL = "#f4ede1";
const WALL_STROKE = "#2a2a2a";
const WALL_WIDTH = 4;
const ITEM_FILL = "#ffffff";
const ITEM_STROKE = "#888";
const ITEM_STROKE_SELECTED = "#b89968";
const LABEL_COLOR = "#333";
// Snap items to a wall when their bounding-box edge is within this many inches.
const WALL_SNAP_INCHES = 6;

export type PlannerCallbacks = {
  onChange: (state: LayoutState) => void;
  onSelectionChange: (item: PlacedItem | null) => void;
};

export class Planner {
  private readonly stage: Konva.Stage;
  private readonly bgLayer: Konva.Layer;
  private readonly itemsLayer: Konva.Layer;
  private readonly roomGroup: Konva.Group;
  private readonly floorRect: Konva.Rect;
  private readonly wallsRect: Konva.Rect;

  private readonly container: HTMLDivElement;
  private readonly callbacks: PlannerCallbacks;

  private room: RoomDims = { widthIn: 144, depthIn: 120 };
  private items: PlacedItem[] = [];
  private nodeByInstance = new Map<string, Konva.Group>();
  private selectedId: string | null = null;
  private pxPerIn = 1;
  private roomOriginPx = { x: 0, y: 0 };

  constructor(container: HTMLDivElement, callbacks: PlannerCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth || 800,
      height: container.clientHeight || 600,
    });

    this.bgLayer = new Konva.Layer({ listening: false });
    this.itemsLayer = new Konva.Layer();
    this.stage.add(this.bgLayer, this.itemsLayer);

    this.floorRect = new Konva.Rect({ fill: FLOOR_FILL });
    this.wallsRect = new Konva.Rect({
      stroke: WALL_STROKE,
      strokeWidth: WALL_WIDTH,
      listening: false,
    });
    this.roomGroup = new Konva.Group({ listening: false });
    this.roomGroup.add(this.floorRect, this.wallsRect);
    this.bgLayer.add(this.roomGroup);

    // Click on empty stage = deselect.
    this.stage.on("click tap", (e) => {
      if (e.target === this.stage || e.target === this.floorRect) {
        this.select(null);
      }
    });

    window.addEventListener("resize", this.resize);
    this.resize();
  }

  destroy(): void {
    window.removeEventListener("resize", this.resize);
    this.stage.destroy();
  }

  setRoom(dims: RoomDims): void {
    this.room = dims;
    this.relayout();
  }

  addItem(product: CatalogProduct): void {
    const placed: PlacedItem = {
      instanceId: crypto.randomUUID(),
      productId: product.id,
      title: product.title,
      widthIn: product.widthIn,
      depthIn: product.depthIn,
      xIn: this.room.widthIn / 2,
      yIn: this.room.depthIn / 2,
      rotation: 0,
    };
    this.clampToRoom(placed);
    this.items.push(placed);
    this.renderItem(placed);
    this.select(placed.instanceId);
    this.emitChange();
  }

  removeSelected(): void {
    if (!this.selectedId) return;
    this.removeItem(this.selectedId);
  }

  rotateSelected(): void {
    if (!this.selectedId) return;
    const item = this.items.find((i) => i.instanceId === this.selectedId);
    if (!item) return;
    item.rotation = ((item.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    this.clampToRoom(item);
    const node = this.nodeByInstance.get(item.instanceId);
    if (node) {
      node.rotation(item.rotation);
      node.x(this.inToPx(item.xIn) + this.roomOriginPx.x);
      node.y(this.inToPx(item.yIn) + this.roomOriginPx.y);
      this.itemsLayer.batchDraw();
    }
    this.emitChange();
    this.emitSelection();
  }

  loadState(state: LayoutState): void {
    this.room = state.room;
    this.items = state.items.map((i) => ({ ...i }));
    for (const node of this.nodeByInstance.values()) node.destroy();
    this.nodeByInstance.clear();
    this.selectedId = null;
    this.relayout();
    for (const item of this.items) this.clampToRoom(item);
    for (const item of this.items) this.renderItem(item);
    this.itemsLayer.batchDraw();
    this.emitSelection();
  }

  getState(): LayoutState {
    return {
      room: { ...this.room },
      items: this.items.map((i) => ({ ...i })),
    };
  }

  resize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.stage.width(w);
    this.stage.height(h);
    this.relayout();
  };

  private relayout(): void {
    const availW = Math.max(50, this.stage.width() - ROOM_PADDING_PX * 2);
    const availH = Math.max(50, this.stage.height() - ROOM_PADDING_PX * 2);
    this.pxPerIn = Math.min(availW / this.room.widthIn, availH / this.room.depthIn);
    const roomWpx = this.room.widthIn * this.pxPerIn;
    const roomHpx = this.room.depthIn * this.pxPerIn;
    this.roomOriginPx = {
      x: (this.stage.width() - roomWpx) / 2,
      y: (this.stage.height() - roomHpx) / 2,
    };
    this.floorRect.position(this.roomOriginPx);
    this.floorRect.size({ width: roomWpx, height: roomHpx });
    this.wallsRect.position(this.roomOriginPx);
    this.wallsRect.size({ width: roomWpx, height: roomHpx });
    this.bgLayer.batchDraw();

    // Resize+reposition every item to match new scale.
    for (const item of this.items) {
      const node = this.nodeByInstance.get(item.instanceId);
      if (!node) continue;
      this.updateNodeGeometry(node, item);
    }
    this.itemsLayer.batchDraw();
  }

  private renderItem(item: PlacedItem): void {
    const group = new Konva.Group({
      draggable: true,
      rotation: item.rotation,
    });
    const rect = new Konva.Rect({
      fill: ITEM_FILL,
      stroke: ITEM_STROKE,
      strokeWidth: 1.5,
      cornerRadius: 2,
      name: "item-rect",
    });
    const label = new Konva.Text({
      text: item.title,
      fontSize: 11,
      fill: LABEL_COLOR,
      align: "center",
      verticalAlign: "middle",
      ellipsis: true,
      listening: false,
      name: "item-label",
    });
    group.add(rect, label);
    this.itemsLayer.add(group);
    this.nodeByInstance.set(item.instanceId, group);

    group.on("click tap", (e) => {
      e.cancelBubble = true;
      this.select(item.instanceId);
    });
    group.on("dragmove", () => {
      const centerInches = this.pxToRoomInches({ x: group.x(), y: group.y() });
      item.xIn = centerInches.x;
      item.yIn = centerInches.y;
      this.clampToRoom(item);
      group.x(this.inToPx(item.xIn) + this.roomOriginPx.x);
      group.y(this.inToPx(item.yIn) + this.roomOriginPx.y);
    });
    group.on("dragend", () => {
      this.snapToWalls(item);
      const node = this.nodeByInstance.get(item.instanceId);
      if (node) {
        node.x(this.inToPx(item.xIn) + this.roomOriginPx.x);
        node.y(this.inToPx(item.yIn) + this.roomOriginPx.y);
        this.itemsLayer.batchDraw();
      }
      this.emitChange();
    });

    this.updateNodeGeometry(group, item);
  }

  private updateNodeGeometry(node: Konva.Group, item: PlacedItem): void {
    const wPx = item.widthIn * this.pxPerIn;
    const dPx = item.depthIn * this.pxPerIn;
    const rect = node.findOne<Konva.Rect>(".item-rect");
    const label = node.findOne<Konva.Text>(".item-label");
    if (rect) {
      rect.x(-wPx / 2);
      rect.y(-dPx / 2);
      rect.width(wPx);
      rect.height(dPx);
      rect.stroke(this.selectedId === item.instanceId ? ITEM_STROKE_SELECTED : ITEM_STROKE);
      rect.strokeWidth(this.selectedId === item.instanceId ? 2.5 : 1.5);
    }
    if (label) {
      label.x(-wPx / 2 + 4);
      label.y(-dPx / 2 + 4);
      label.width(Math.max(8, wPx - 8));
      label.height(Math.max(8, dPx - 8));
    }
    node.x(this.inToPx(item.xIn) + this.roomOriginPx.x);
    node.y(this.inToPx(item.yIn) + this.roomOriginPx.y);
    node.rotation(item.rotation);
  }

  private removeItem(instanceId: string): void {
    const idx = this.items.findIndex((i) => i.instanceId === instanceId);
    if (idx < 0) return;
    this.items.splice(idx, 1);
    const node = this.nodeByInstance.get(instanceId);
    if (node) {
      node.destroy();
      this.nodeByInstance.delete(instanceId);
    }
    if (this.selectedId === instanceId) {
      this.selectedId = null;
      this.emitSelection();
    }
    this.itemsLayer.batchDraw();
    this.emitChange();
  }

  private select(instanceId: string | null): void {
    if (this.selectedId === instanceId) return;
    const prev = this.selectedId;
    this.selectedId = instanceId;
    for (const id of [prev, instanceId]) {
      if (!id) continue;
      const node = this.nodeByInstance.get(id);
      const item = this.items.find((i) => i.instanceId === id);
      if (node && item) this.updateNodeGeometry(node, item);
    }
    this.itemsLayer.batchDraw();
    this.emitSelection();
  }

  // Inches relative to room origin.
  private inToPx(inches: number): number {
    return inches * this.pxPerIn;
  }

  private pxToRoomInches(pos: { x: number; y: number }): { x: number; y: number } {
    return {
      x: (pos.x - this.roomOriginPx.x) / this.pxPerIn,
      y: (pos.y - this.roomOriginPx.y) / this.pxPerIn,
    };
  }

  // Returns a data URL of the current stage. Caller is expected to wire this into
  // a download link or "Save image" UX. Scaled 2× for retina-quality output.
  exportPNG(): string {
    return this.stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
  }

  private snapToWalls(item: PlacedItem): void {
    const isSideways = item.rotation === 90 || item.rotation === 270;
    const effW = isSideways ? item.depthIn : item.widthIn;
    const effD = isSideways ? item.widthIn : item.depthIn;
    const halfW = effW / 2;
    const halfD = effD / 2;
    // Distance from each wall to the item's bounding-box edge.
    const distLeft = item.xIn - halfW;
    const distRight = this.room.widthIn - (item.xIn + halfW);
    const distTop = item.yIn - halfD;
    const distBottom = this.room.depthIn - (item.yIn + halfD);
    if (distLeft >= 0 && distLeft < WALL_SNAP_INCHES) item.xIn = halfW;
    else if (distRight >= 0 && distRight < WALL_SNAP_INCHES) item.xIn = this.room.widthIn - halfW;
    if (distTop >= 0 && distTop < WALL_SNAP_INCHES) item.yIn = halfD;
    else if (distBottom >= 0 && distBottom < WALL_SNAP_INCHES) item.yIn = this.room.depthIn - halfD;
  }

  private clampToRoom(item: PlacedItem): void {
    const isSideways = item.rotation === 90 || item.rotation === 270;
    const effW = isSideways ? item.depthIn : item.widthIn;
    const effD = isSideways ? item.widthIn : item.depthIn;
    const halfW = effW / 2;
    const halfD = effD / 2;
    if (effW > this.room.widthIn) {
      item.xIn = this.room.widthIn / 2;
    } else {
      item.xIn = Math.max(halfW, Math.min(this.room.widthIn - halfW, item.xIn));
    }
    if (effD > this.room.depthIn) {
      item.yIn = this.room.depthIn / 2;
    } else {
      item.yIn = Math.max(halfD, Math.min(this.room.depthIn - halfD, item.yIn));
    }
  }

  private emitChange(): void {
    this.callbacks.onChange(this.getState());
  }

  private emitSelection(): void {
    const item = this.selectedId
      ? this.items.find((i) => i.instanceId === this.selectedId) ?? null
      : null;
    this.callbacks.onSelectionChange(item ? { ...item } : null);
  }
}
