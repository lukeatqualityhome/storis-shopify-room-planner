# storis-api-inventory-to-shopify

Syncs product dimensions (width / depth / height in inches) from STORIS into
Shopify product metafields. Phase 2 of the qualityhome.com room planner project
(Phase 3 — Konva.js 2D room planner page — will also live in this repo).

## What it writes

For each matched product, three metafields under namespace `custom`:

| key         | type             | source field (STORIS)        |
| ----------- | ---------------- | ---------------------------- |
| `width_in`  | `number_decimal` | Width / W / widthIn          |
| `depth_in`  | `number_decimal` | Depth / D / depthIn          |
| `height_in` | `number_decimal` | Height / H / heightIn        |

Matching is done by SKU: STORIS `sku` / `itemCode` ↔ Shopify variant SKU →
parent product.

## Setup

```powershell
cd C:\QHF\code\storis-api-inventory-to-shopify
copy .env.example .env
# fill in STORIS_* and SHOPIFY_* values
npm install
```

The Shopify admin token needs `write_products` scope (covers product metafields).

## Running

```powershell
# Dry-run — fetches STORIS products, looks them up in Shopify, prints what
# WOULD be written. No mutations.
npm run sync

# Live — actually writes the metafields via metafieldsSet.
npm run sync:live

# Cap the number of STORIS rows processed (useful for first live test).
npx tsx src/index.ts --live --limit=10
```

Stats summary is printed at the end:

```json
{
  "scanned": 1240,
  "matched": 1180,
  "written": 1180,
  "skippedNoDims": 35,
  "skippedNoShopifyMatch": 25,
  "errors": 0
}
```

## Discovering STORIS category names

`PRIORITY_CATEGORIES` has to match the strings STORIS actually returns. Run
this once to see them sorted by product count (`withDims` column shows how
many had at least one dimension populated — that's what's actually useful
for the room planner):

```powershell
npm run discover-categories          # full catalog, Ctrl-C when satisfied
npx tsx src/index.ts --discover-categories --limit=2000 --top=80
```

Output is tab-separated; redirect to a file to paste into a spreadsheet.

## Priority categories

Sync is scoped to the categories defined in `src/config.ts`:

- Sofas
- Sectionals
- Beds
- Dining Tables
- Accent Chairs

Override via `PRIORITY_CATEGORIES` in `.env` (comma-separated).

## Known TODOs in the STORIS client

`src/storis.ts` uses placeholder shapes for the auth endpoint and the
Products/Detail endpoint. Before the first live run, verify against STORIS
docs:

- OAuth token endpoint path + grant type
- Products/Detail URL, pagination params (`page`/`pageSize` vs `offset`/`limit`),
  and the exact field names for dimensions

The normalizer in `normalizeStorisProduct` already tries common casings
(`Width`, `width`, `W`, `widthIn`); add the real ones once known.

## Phase 3 — Room Planner page

The Konva.js room planner that ships at `/pages/room-planner` lives in
`web/` (the bundle) and `shopify/` (the theme integration files).

```powershell
cd web
npm install
npm run dev        # local preview at http://localhost:5173
npm run build      # produces web/dist/room-planner.{js,css}
```

For the dev preview to load real products, edit `web/index.html` and set
`data-storefront-token` to a real Storefront API token. See
`shopify/README.md` for deployment + Storefront token creation steps.

Phase 3 depends on Phase 2 having populated `custom.width_in` and
`custom.depth_in` metafields on a meaningful number of products, and
those metafield definitions being exposed to the Storefront.
