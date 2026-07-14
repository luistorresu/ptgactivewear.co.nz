# PTG Activewear Admin And Inventory

## Status

The D1 admin and inventory system is live in production. The catalogue uses the production D1 database and the admin uses approved-email one-time codes delivered by Resend.

Admin URL: `/admin`

The initial seed contains the five approved products, existing image galleries, current sizes, generated internal SKUs, and the existing NZD $20 Player Name and Player Number prices for the Tournament Player Kit. Initial stock is zero and `track_inventory` is off so production availability cannot change accidentally before real quantities are entered.

## Architecture

* Public products: browser requests `GET /api/products`; `js/products.js` remains the temporary display fallback.
* Admin: the Worker protects `/admin*` and `/api/admin/*` with approved-email one-time codes, encrypted random session tokens, KV expiry, and `HttpOnly` cookies. Cloudflare Access JWT validation remains supported if Access is added later.
* Catalogue and stock: D1 binding `DB`.
* Webhook idempotency: KV binding `ORDER_EVENT_STORE` plus unique D1 event/session constraints.
* Paid orders: one atomic D1 batch saves the order and items, deducts tracked stock, and records stock movements.
* Email: Resend runs after the D1 inventory commit. A retry cannot deduct stock twice.

## Local Development

Requirements: Node.js 20 or newer and PowerShell.

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Put only Stripe test keys and an appropriate Resend key in `.dev.vars`.
3. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
   ```

4. Open `http://127.0.0.1:8787/admin`.
5. Open `http://127.0.0.1:8787/shop.html` to test the D1 catalogue.

The script applies local migrations, safely re-runs the seed, keeps local D1 files outside the static asset folder, and starts Wrangler. Local authentication only activates on `localhost` or `127.0.0.1` while `ENVIRONMENT=development`.

Run code checks and tests:

```powershell
npm run check
npm test
```

## Cloudflare Resources

The production D1 database and KV namespace were created, migrated, seeded, and bound on 2026-07-13.

Create D1 and copy the returned database ID into `wrangler.jsonc`:

```powershell
npx wrangler d1 create ptgactivewear-catalog
```

Create the webhook KV namespace and copy its ID into `wrangler.jsonc`:

```powershell
npx wrangler kv namespace create ORDER_EVENT_STORE
```

After approval, apply and seed production:

```powershell
npx wrangler d1 migrations apply ptgactivewear-catalog --remote
npx wrangler d1 execute ptgactivewear-catalog --remote --file seed\seed-products.sql
```

Required bindings and variables:

* D1 binding: `DB`
* KV binding: `ORDER_EVENT_STORE`
* `CATALOG_SOURCE=d1`
* `INVENTORY_ENFORCEMENT=d1`
* `CHECKOUT_ENABLED=true`
* `LOW_STOCK_THRESHOLD=5`
* `ENVIRONMENT=staging` or `production`
* `ADMIN_ALLOWED_EMAILS=comma-separated approved addresses`

Existing Stripe and Resend secrets remain encrypted Worker secrets. Never place them in `wrangler.jsonc`, HTML, or browser JavaScript.

## Admin Sign-In

1. Open `https://ptgactivewear.co.nz/admin`.
2. Enter one of the approved administrator email addresses.
3. Enter the six-digit code delivered by Resend. Codes expire after 10 minutes and requests are rate-limited.
4. The secure session expires after eight hours. Use Log out when finished.

Approved addresses are controlled by `ADMIN_ALLOWED_EMAILS`. Adding an address to the frontend does not grant access.

## Optional Cloudflare Access

1. In Cloudflare Zero Trust, open Access > Applications.
2. Add self-hosted applications for `ptgactivewear.co.nz/admin*` and `ptgactivewear.co.nz/api/admin/*`. Use the same policy for both.
3. Create an Allow policy containing only approved administrator email addresses.
4. Enable email one-time PIN or the approved identity provider.
5. Copy the application audience tag into `ACCESS_AUD`. If Cloudflare gives the two applications different audience tags, configure one application with both paths or extend `ACCESS_AUD` to an approved comma-separated list before deployment.
6. Set `ACCESS_TEAM_DOMAIN` and `ADMIN_ALLOWED_EMAILS` on the Worker.
7. Confirm an unapproved browser receives an Access challenge and unauthenticated API requests return `401`.

The Worker validates the JWT signature, audience, expiry, and email. Admin mutations also require same-origin JSON and `X-PTG-Admin-Request: 1`.

## Admin Operations

* Products: create inactive draft products, then edit name, description, price, category, type, badge, visibility, sale availability, featured state, inventory tracking, and personalisation. Add variants, stock, and pictures before publishing. Raw image paths are not accepted by the form or product-update API.
* Pictures: view safe previews, edit alt text, assign a style gallery, reorder, select the main image, replace, and remove after confirmation. R2 upload supports JPEG, PNG, and WebP up to 8 MB and validates the actual file signature.
  The Worker requires the `PRODUCT_IMAGES` R2 binding configured in `wrangler.jsonc`, backed by the `ptgactivewear-product-images` bucket.
* Variants: edit SKU, size, colour, style, and active state; add new variants with zero starting stock.
* Stock: set exact, increase, or decrease. Every change requires a reason and writes `stock_movements` plus an admin audit entry.
* Orders: search by order/customer/email, filter by date/payment/fulfilment, inspect immutable purchase snapshots, addresses, Stripe references, refund state, stock movements, internal notes, and fulfilment history.
* Fulfilment: move orders through Paid, Processing, Ready for collection, Shipped, Completed, Cancelled, or Refunded. Each change records old/new status, admin, timestamp, and optional reason without rewriting Stripe payment history.
* Dashboard: operational sales today/month, paid order count, awaiting fulfilment, low/out-of-stock variants, recent orders, and recent stock adjustments.
* Theme: light/dark choice is stored only as `ptg-admin-theme` in browser `localStorage`; first visit follows the operating-system preference and reduced-motion settings are respected.
* Exact stock and customer/order data are never returned by public APIs.

## Invoices

Paid orders receive an invoice number only when an authorised administrator first opens the invoice. Number allocation uses an atomic D1 `invoice_sequence` statement and format `PTG-YYYY-000001`. Numbers are unique, permanent, server-generated, and never reused; a failed concurrent allocation may leave a harmless gap.

Invoice routes and assets remain under `/admin` and `/api/admin`, so the existing server-side admin authentication is required. The invoice is a branded A4 HTML document with a **Print / Save PDF** action using the browser print dialog. This is the Cloudflare-compatible PDF approach; no heavyweight PDF runtime is deployed. It is deliberately not labelled as a GST tax invoice because no valid GST configuration has been supplied.

## CSV Exports

Authenticated exports are available for orders, inventory, and stock movements. Orders inherit the active search/date/status filters. Files are UTF-8 with dated names. Every cell is quoted and values beginning with spreadsheet formula characters are prefixed safely. Export actions are recorded in `admin_audit_log`.

## Operational Scope

This admin system is an operational order and stock-management tool. It is not a replacement for professional accounting software or statutory tax advice.

## R2 Picture Storage

Required bucket and Worker binding:

```powershell
npx wrangler r2 bucket create ptgactivewear-product-images
```

Add this binding to `wrangler.jsonc` only after R2 is enabled on the account:

```json
"r2_buckets": [
  { "binding": "PRODUCT_IMAGES", "bucket_name": "ptgactivewear-product-images" }
]
```

Then deploy and test one upload, main-image change, reorder, replace, and removal. Static image rows stay active as rollback-safe fallback data. R2 object keys are generated server-side and are never editable in the browser.

## Deployment And Rollback

Before production migration, export D1 and record the current Worker version. Apply migrations with `wrangler d1 migrations apply ptgactivewear-catalog --remote`, deploy with `wrangler deploy`, and verify `/api/products`, `/shop.html`, `/admin`, checkout session creation, and signed webhook handling.

For code rollback, deploy the previously recorded Worker version from Cloudflare Deployments or revert the release commit and deploy. Migration `0003` is additive; leave its columns in place during rollback. The previous static image rows remain in D1 with `active=0` and can be reactivated without deleting orders, stock, or R2 objects.

## Inventory And Stripe

Checkout loads the product and variant from D1, validates activity, stock, quantity, personalisation permissions, and server-side prices, then creates Stripe Checkout. Browser prices are ignored.

Stock is not reserved when Checkout is created. It is deducted only after a verified successful webhook. D1 constraints prevent negative stock, and the order, items, deductions, and stock movements are committed atomically. Duplicate webhook delivery is protected by both KV and unique D1 constraints.

`STRIPE_WEBHOOK_SECRET` is configured as an encrypted production Worker secret. Stripe sends `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed` to `/api/stripe-webhook`. Paid orders, stock deductions, order emails, and admin order records are finalised only after signature verification.

There remains a small overselling risk when two customers pay for the final unit at nearly the same time. A reservation system is the recommended later enhancement.

## Migration And Rollback

1. Keep `js/products.js` and the static Worker catalogue unchanged during testing.
2. Test local D1 and a separate staging Worker with Stripe test keys.
3. Enter and verify real stock in staging.
4. Apply the production schema and seed only after approval.
5. Switch `CATALOG_SOURCE` and `INVENTORY_ENFORCEMENT` to `d1` only after verification.
6. If public D1 reads fail, the browser keeps the static display catalogue.
7. If D1 inventory validation fails after cutover, checkout fails closed rather than accepting stock-blind payments.
8. Roll back public display to `CATALOG_SOURCE=static`; preserve D1 order and stock data for investigation.

Migration `0002_orders_invoices_exports.sql` is additive: it adds order/invoice fields, historical item option fields, `invoice_sequence`, `fulfilment_history`, and indexes. It contains no drop, delete, or rename statements. Before its production application, the D1 export was saved outside Git at `C:\Users\Nico\Documents\ptgactivewear-backups\ptgactivewear-d1-20260713-212637.sql`.

Code rollback uses the previous Cloudflare Worker version. Database rollback normally leaves additive columns/tables in place because older code ignores them; restoring the SQL export is reserved for database corruption and would overwrite newer records, so it must not be used casually.

## Known Limitations

* Product uploads are not included. Admin can select existing `/photos` files; R2 is recommended for future uploads.
* Existing Stripe order history is not imported; D1 records new successful payments after cutover.
* Initial inventory quantities must be entered before enabling tracking per product.
* A separate staging Worker and Cloudflare Access application are not currently configured.
* Stripe refund webhooks are not yet implemented. Future handlers should cover `refund.created`, `refund.updated`, and `charge.refunded`, update `refund_status`, and use Stripe event IDs plus `restocked_at` to prevent duplicate restocking.
* The invoice PDF action uses the browser's Save as PDF flow rather than binary PDF generation inside the Worker.
