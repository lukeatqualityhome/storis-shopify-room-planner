export type RoomDims = {
  widthIn: number;
  depthIn: number;
};

export type CatalogProduct = {
  id: string;
  title: string;
  imageUrl: string | null;
  category: string;     // STORIS category id, drives the fallback icon
  widthIn: number;
  depthIn: number;
};

export type PlacedItem = {
  // Unique instance id (one product can be placed many times).
  instanceId: string;
  productId: string;
  title: string;
  widthIn: number;
  depthIn: number;
  // Center position in inches, measured from the room's top-left corner.
  // Stored as center so rotation pivots cleanly around the item's geometric middle.
  xIn: number;
  yIn: number;
  // 0 / 90 / 180 / 270 degrees.
  rotation: 0 | 90 | 180 | 270;
};

export type LayoutState = {
  room: RoomDims;
  items: PlacedItem[];
};

export type MountConfig = {
  catalogUrl: string;
};
