# Shopify deployment — Room Planner

This folder holds the Shopify theme files for Phase 3. The Konva.js bundle
itself lives in `../web/` and is built into `../web/dist/`.

Deployment is three independent things:

1. **Expose the dimension metafields to the Storefront API** — without this,
   the planner can't read width/depth and the palette stays empty.
2. **Create a Storefront API access token** — the planner uses it to query
   products + metafields from the browser.
3. **Install the section + template + built bundle into your theme** — and
   create the `/pages/room-planner` page.

Do them in this order.

---

## 1. Expose the dimension metafields to the Storefront

The Phase 2 sync (in `../src/`) writes three metafields on each product:

- `custom.width_in`
- `custom.depth_in`
- `custom.height_in`

For the planner to read them via the Storefront API, each metafield
**definition** must have Storefront access enabled.

1. In Shopify Admin, go to **Settings → Custom data → Products**.
2. For each of `width_in`, `depth_in`, `height_in`:
   - Open the definition (create it first if it doesn't exist — type
     "Decimal number", namespace `custom`, key `width_in` / etc.).
   - Click **Storefronts** (or "Access" depending on Admin version).
   - Toggle **Storefront access** on / select **Read access**.
   - Save.
3. Repeat for all three.

If you skip this step, the GraphQL `metafield(...)` field will return `null`
even though the metafield exists on the product, and the planner palette
will look empty.

---

## 2. Create a Storefront API access token

This token is **public** — it lives in the browser. Scope it tightly.

1. Shopify Admin → **Settings → Apps and sales channels → Develop apps**
   (enable custom app development if prompted).
2. **Create an app**, name it something like `Room Planner Storefront`.
3. Open the app → **Configuration** → **Storefront API integration** →
   **Configure**. Enable at minimum:
   - `unauthenticated_read_product_listings`
   - `unauthenticated_read_product_inventory` *(optional, not used today)*
   - Metafield access: select the `custom` namespace (or `custom.width_in`,
     `custom.depth_in`, `custom.height_in` individually if Shopify offers
     per-key selection).
4. Save. Go to **API credentials** → copy the **Storefront API access token**
   (it looks like `shpat_*` or a long hex string — *not* the Admin token).

Keep this token handy for step 3.

---

## 3. Install into the theme & create the page

You can do this via the Shopify CLI or the Admin UI. Steps below use the
Admin UI since it's the most accessible.

### a. Build the bundle

```powershell
cd C:\QHF\code\storis-api-inventory-to-shopify\web
npm install
npm run build
```

This produces:

- `web/dist/room-planner.js`
- `web/dist/room-planner.css`

### b. Upload to the theme

1. In Shopify Admin → **Online Store → Themes → [your live theme] →
   Actions → Edit code**.
2. In the **Assets** folder, click **Add a new asset** and upload both
   `room-planner.js` and `room-planner.css`.
3. In the **Sections** folder, click **Add a new section**, name it
   `room-planner`, paste the contents of
   `shopify/sections/room-planner.liquid` (this repo) into it.
4. In the **Templates** folder, click **Add a new template** → "page" type
   → suffix `room-planner` → file format **JSON**. Paste the contents of
   `shopify/templates/page.room-planner.json`.

### c. Create the `/pages/room-planner` page

1. Shopify Admin → **Online Store → Pages → Add page**.
2. Title: `Room Planner` (or whatever you want shown to customers).
3. Handle: `room-planner` (this makes the URL `/pages/room-planner`).
4. Under **Online store → Template**, choose **page.room-planner**.
5. Save.

### d. Configure the Storefront token in the section

1. Theme editor (**Online Store → Themes → Customize**).
2. Navigate to **Pages → Room Planner**.
3. Click the **Room Planner** section in the left sidebar.
4. Paste the Storefront API token from step 2 into the
   **Storefront API access token** field.
5. Save.

Open `/pages/room-planner` on the storefront. You should see:

- The room size form populated with a default 12'×10' room.
- The product palette progressively populating with any product that has
  `custom.width_in` AND `custom.depth_in` set.
- The status line showing `Ready. N products available.` once loading is
  done.

---

## Troubleshooting

**Palette stays empty / "No products have width/depth metafields yet."**
Phase 2 hasn't populated metafields, or storefront access on the
definitions isn't enabled. Test with the Admin Shopify GraphiQL app:

```graphql
{
  products(first: 5) {
    nodes {
      title
      widthIn: metafield(namespace: "custom", key: "width_in") { value }
      depthIn: metafield(namespace: "custom", key: "depth_in") { value }
    }
  }
}
```

If `widthIn` is `null` even though the Admin shows a value on the product,
the metafield isn't exposed to the storefront.

**"Mount element is missing data-shop-domain or data-storefront-token"**
The section setting `storefront_token` is empty. Re-do step 3d.

**Items drag outside the room walls**
Shouldn't happen — items are clamped to room bounds in `planner.ts`. If you
see it, open browser dev tools and screenshot for triage.

**The bundle is too big**
Konva is ~60% of the JS. If load time on slow connections matters more than
features, we can swap to a hand-rolled `<canvas>` implementation. Not
recommended; Konva pays for itself in maintenance.
