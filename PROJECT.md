# PTG Activewear Website

## Website

ptgactivewear.co.nz

## Purpose

PTG Activewear is an activewear / sportswear website. The website should look clean, modern, professional, and sporty.

## Local Folder

C:\Users\Nico\Documents\ptgactivewear-security-phase2

## Assets

Main image/photo folder:

C:\Users\Nico\Documents\ptgactivewear-security-phase2\photos

Current clothing/product images folder:

C:\Users\Nico\Documents\ptgactivewear-security-phase2\photos\clouth

Logo files and product images should be checked in these folders first before adding new assets.

## Hosting

The website is hosted/deployed using Cloudflare Pages / Workers.

## Domain

The domain is managed through Cloudflare:

ptgactivewear.co.nz

Both `ptgactivewear.co.nz` and `www.ptgactivewear.co.nz` are attached to the production Worker as Cloudflare custom domains. The `www` hostname redirects permanently to the canonical root domain while preserving the path and query string.

## Source Control

The project uses a GitHub repository.

## Workflow

Preferred workflow:

1. Make changes locally or through Codex.
2. Review changed files.
3. Test locally.
4. Commit to GitHub.
5. Let Cloudflare deploy from GitHub.

## Important Notes

* Do not deploy automatically unless requested.
* Do not change Cloudflare settings unless requested.
* Do not change GitHub repository settings unless requested.
* Keep changes focused and easy to review.

## Stripe Checkout

Stripe Checkout is configured in the existing production mode. Never switch Stripe modes or replace payment secrets during routine website work.

Required Cloudflare Worker variables/secrets:

* `STRIPE_SECRET_KEY` - encrypted secret, test mode first.
* `STRIPE_WEBHOOK_SECRET` - encrypted secret from the Stripe webhook endpoint.
* `SITE_URL` - `https://ptgactivewear.co.nz`.
* `EMAIL_PROVIDER` - `resend`.
* `EMAIL_API_KEY` - encrypted Resend secret.
* `CONTACT_TO_EMAIL` - `info@ptgactivewear.co.nz`.
* `CONTACT_FROM_EMAIL` - `info@ptgactivewear.co.nz`.
* `PAYMENT_SURCHARGE_ENABLED` - `false` until account pricing and a surcharge-free alternative are confirmed.
* `PAYMENT_SURCHARGE_PERCENT` - configured percentage with at most two decimal places, currently `2.65`.
* `PAYMENT_SURCHARGE_FIXED_CENTS` - fixed NZD cents component, currently `30`.
* `PAYMENT_SURCHARGE_LABEL` - customer-facing fee label.
* `PAYMENT_SURCHARGE_DESCRIPTION` - customer-facing explanation.
* `PICKUP_ENABLED`, `PICKUP_LABEL`, and `PICKUP_PRICE_CENTS` - trusted pickup configuration; pickup must remain zero cents.
* `PICKUP_LOCATION_NAME`, `PICKUP_ADDRESS_LINE_1`, `PICKUP_ADDRESS_LINE_2`, `PICKUP_CITY`, `PICKUP_POSTCODE`, and `PICKUP_INSTRUCTIONS` - customer-facing collection details.
* `NZ_DELIVERY_ENABLED`, `NZ_DELIVERY_LABEL`, `NZ_DELIVERY_PRICE_CENTS`, and `NZ_DELIVERY_COUNTRY` - trusted NZ-only delivery configuration, currently NZ$5.00.

Optional:

* `STRIPE_PUBLISHABLE_KEY` is not currently required because the site uses Stripe-hosted Checkout through the backend.
* `ORDER_EVENT_STORE` should be a Cloudflare KV namespace binding used by the Stripe webhook for idempotency.

Stripe endpoints:

* Checkout session: `POST /api/create-checkout-session`
* Webhook: `POST /api/stripe-webhook`
* Success redirect: `/order-success?session_id={CHECKOUT_SESSION_ID}`
* Cancel redirect: `/cart?checkout=cancelled`

The cart requires Customer Name followed by Child's Name before a new Stripe Checkout Session can be created. Both values are validated in the browser for immediate feedback and again by the Worker. Child's Name is stored in versioned Stripe metadata, then copied into the D1 order and invoice snapshots by the verified paid webhook. It appears in protected admin order search, fulfilment workflows, order emails, invoices, and exports. Historical orders may have a blank Child's Name because migration `0020_order_child_name.sql` is intentionally nullable.

Product prices are controlled server-side in `_worker.js` in the `SERVER_PRODUCTS` catalogue. Frontend display data is controlled in `js/products.js`. Keep both aligned when changing products.

Fulfilment is selected in the cart and recalculated server-side. Pickup is free and does not request a Stripe shipping address. Delivery is NZ$5.00 and Stripe Checkout restricts shipping-address collection to New Zealand. No paid address-autocomplete provider is connected; Stripe-hosted/manual address entry remains available. The exact training-centre street address must be added to the pickup environment values when confirmed.

Afterpay/Clearpay should be enabled in the Stripe Dashboard under Payment methods. The integration uses Stripe dynamic payment methods, so availability depends on Stripe account configuration, currency, order amount, customer eligibility, and Stripe support in New Zealand.

Local testing:

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Add Stripe test-mode secrets and the Resend test/live key locally.
3. Run with Wrangler so Worker endpoints are available:
   `wrangler dev _worker.js --assets . --compatibility-date 2026-07-06 --compatibility-flag nodejs_compat`
4. Use Stripe test cards in Checkout.
5. Use the Stripe CLI to forward webhooks to `/api/stripe-webhook`, then copy the generated `whsec_...` value into `STRIPE_WEBHOOK_SECRET`.

Cloudflare setup commands:

* `wrangler secret put STRIPE_SECRET_KEY --name ptgactivewear`
* `wrangler secret put STRIPE_WEBHOOK_SECRET --name ptgactivewear`
* `wrangler secret put EMAIL_API_KEY --name ptgactivewear`
* Add normal variables for `SITE_URL`, `EMAIL_PROVIDER`, `CONTACT_TO_EMAIL`, and `CONTACT_FROM_EMAIL`.
* Add a KV namespace binding named `ORDER_EVENT_STORE` before enabling fulfilment emails in production.

Cloudflare manual KV setup if Wrangler cannot create it:

1. Open Cloudflare Dashboard.
2. Go to Storage & Databases.
3. Open KV.
4. Create a namespace named `ptgactivewear-order-events`.
5. Go to Compute.
6. Open Workers & Pages.
7. Open the `ptgactivewear` Worker.
8. Go to Settings.
9. Open Bindings.
10. Add a KV namespace binding.
11. Set the variable name to `ORDER_EVENT_STORE`.
12. Select `ptgactivewear-order-events`.
13. Save and redeploy the Worker.

Stripe test webhook setup if Stripe CLI is unavailable:

1. Open Stripe Dashboard.
2. Ensure Test mode is enabled.
3. Go to Developers.
4. Open Webhooks.
5. Add an endpoint with URL `https://ptgactivewear.co.nz/api/stripe-webhook`.
6. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, and `charge.refunded`.
7. Reveal the signing secret.
8. Add it to Cloudflare as encrypted secret `STRIPE_WEBHOOK_SECRET`.
9. Redeploy the Worker after adding the secret.

Stripe test payment setup:

1. Add `STRIPE_SECRET_KEY` to the `ptgactivewear` Worker as an encrypted secret using a Stripe test-mode secret key.
2. Do not use live-mode Stripe keys until testing is complete and approved.
3. Use test card `4242 4242 4242 4242` with any future expiry date and any CVC.

## Fundraising Prize Drawing (Local Only)

The local implementation includes a reusable Patagonia FC Tournament Fundraising Prize Drawing at `/raffle` with 36 numbers at NZD 20.00 each and a DJI Neo Drone prize. Customer-facing wording uses prize drawing, entry and drawing number. The established internal raffle identifiers remain unchanged to preserve tested routes and database compatibility. It is intentionally separate from the merchandise cart: customers reserve exactly one available number, then donate on the official Givealittle fundraiser at `https://givealittle.co.nz/cause/patagonia-fc-tournament-fundraiser-2026`. The website does not process drawing payments, add shipping or apply merchandise promotions or payment surcharges.

Migration `0024_fundraising_raffles.sql` adds raffle definitions, temporary reservations, durable raffle orders and unique number ownership. Migration `0025_givealittle_fundraiser.sql` adds donor contact metadata and the external Givealittle reference. Conditional D1 updates allow only one competing reservation to claim each number. Reservations last 24 hours so an administrator can confirm the donation in Givealittle. No documented Givealittle payment-verification webhook is integrated, so opening or returning from Givealittle never marks a number sold. The donor is instructed to include `Patagonia FC drawing number #NN` in the Givealittle message, and an authorised administrator must explicitly mark the matching reserved number sold or release it.

Local development loads `seed/seed-raffle-test.sql`, which leaves 1–3 available, 4 reserved and 5–6 sold. This test seed must never be applied to production. The authenticated Admin Raffles view shows private reservation details only to authorised administrators and provides explicit `Mark Sold` and `Release` actions for reserved numbers.

The supplied DJI Neo Drone photograph is stored at `assets/images/dji-neo-prize.jpg` and is used in the prize panel and social metadata. Before production launch, confirm and publish the draw date, draw method, eligibility, winner notification, prize collection or delivery, cancellation and refund rules, and all required New Zealand gambling disclosures. Changing the customer-facing name does not alter the paid chance-based mechanics. Until these details are confirmed, the page must retain its explicit terms-pending notice and the production migration must not be applied.

## Admin And D1 Inventory

The local Phase 2 implementation adds a protected admin portal at `/admin`, D1 migrations and seed data, public D1 catalogue endpoints, admin APIs, checkout inventory validation, paid-order storage, atomic stock deduction, and stock audit history.

Production remains unchanged until the D1 database, KV binding, Cloudflare Access applications, remote migration, staging tests, and deployment are separately approved.

Required admin configuration:

* D1 binding `DB`
* KV binding `ORDER_EVENT_STORE`
* `CATALOG_SOURCE`
* `INVENTORY_ENFORCEMENT`
* `CHECKOUT_ENABLED`
* `LOW_STOCK_THRESHOLD`
* `ENVIRONMENT`
* `ADMIN_USERNAME`
* encrypted `ADMIN_PASSWORD_HASH`
* encrypted `SESSION_SECRET`

Operational, migration, rollback, authentication, and local-development instructions are in `ADMIN.md`.

## Operational Admin

The production admin is a deliberately simple D1/R2-backed tool for products, variants, stock, orders, and product pictures. The Orders view exposes payment breakdowns without permitting browser-side total edits. Existing invoice, export, and audit APIs remain available for compatibility and historical records. Authentication uses PBKDF2 password verification, signed expiring `HttpOnly` sessions, KV invalidation, CSRF protection, and login lockout. See `ADMIN.md`.

Paid orders are created only from verified Stripe webhooks. Both encrypted production secrets, `STRIPE_WEBHOOK_SECRET` and `STRIPE_SECRET_KEY`, are configured. Refund amounts are ingested from idempotent `charge.refunded` events; automatic inventory restocking is not enabled.

## Payment Processing Surcharge

Checkout supports an optional server-calculated card processing surcharge. Money calculations use integer cents and the percentage is represented internally as basis points. The browser sends product selections and quantities; `/api/checkout-summary` and `/api/create-checkout-session` both recalculate merchandise, personalisation, shipping, surcharge, and total from D1.

When enabled, the surcharge is one separate Stripe Checkout line item and Checkout is restricted to card payments. The exact configuration is copied into Stripe metadata and stored on the paid D1 order by the verified webhook. Historical orders keep their original totals and empty/zero surcharge snapshot fields.

Production remains disabled because the connected account's negotiated pricing cannot be read through the available Stripe API and the website does not yet provide a confirmed surcharge-free online payment option. Before enabling, review the Stripe Dashboard payment-fee report, provide a surcharge-free option where feasible, and confirm the configured amount does not exceed actual incremental acceptance cost.

A full refund records the full surcharge as refunded. A partial refund preserves the original surcharge and records a surcharge component only when Stripe Refund metadata explicitly supplies `payment_surcharge_refund_cents`.

This admin system is an operational order and stock-management tool. It is not a replacement for professional accounting software or statutory tax advice.

## Sales Reports And Invoice Retention

The protected `/admin/reports` workspace reads sales from D1 and supports date, payment, fulfilment, pickup/delivery, product, customer, order, invoice, SKU, and Stripe Payment Intent searches. Summary totals and CSV values use the integer-cent order snapshots written by the verified Stripe webhook.

Generated invoices are frozen in the D1 `invoices` table with a unique invoice number, customer and fulfilment data, item details, totals, currency, status, and a complete JSON snapshot. The admin invoice page renders from this snapshot and supports printing or saving through the browser's PDF print destination. No public invoice URLs or public invoice cache are used.

## Product Pictures

Product image metadata is stored in D1. Existing checked-in `/photos` files remain the production fallback. Admin uploads use the `PRODUCT_IMAGES` R2 binding and are served through `/product-images/{id}`; the browser never supplies an object key or raw public path.

The R2 bucket name is `ptgactivewear-product-images`. The binding is configured in `wrangler.jsonc`; if it is unavailable, uploads fail without changing image metadata and existing static images continue to work.

New products are saved as safe drafts. Product, variant, starting-stock movement, and audit records are written in one D1 batch. Selected initial images are then uploaded to R2; any failed upload is recoverable from the Pictures workspace without recreating the product.

Active saleable products have canonical `/products/{slug}` pages with Product/Breadcrumb structured data. The dynamic `/sitemap.xml` and `/merchant-feed.xml` endpoints are generated from the same public D1 catalogue.

The Patagonia FC Personalised Mug remains one product with Style 1 and Style 2 variants. Style 1 disallows Player Name and Player Number. Style 2 permits both options at the existing product prices, currently zero dollars; no new fee is inferred.

The Patagonia FC Training Kit keeps optional Player Name and Shirt Number fields at no additional charge. D1 is authoritative for both zero-cent option prices, and checkout must not replace those values with a hardcoded personalisation fee.

Public stock labels are `In Stock`, `Only a few left`, and `Out of Stock`. Exact quantities remain admin-only. D1 validates and atomically reserves tracked stock before Stripe Checkout; the verified paid webhook commits that reservation to the order without deducting it twice. Failed and expired checkout attempts release the reservation idempotently.

## Promotions

Promotions are stored in D1 using the `promotions` and `promotion_products` tables. Checkout normalises customer codes and loads both the promotion and its explicit product eligibility server-side before calculating totals. Browser-supplied prices, discount values, eligibility flags, subtotals and totals are ignored.

The initial `SPRING` promotion is active with no start date, end date, global usage limit or per-customer limit. It applies a 20% discount only to `patagonia-fc-performance-tracksuit`. It excludes personalisation, fulfilment charges, processing surcharges and all other products, including `patagonia-fc-training-kit`.

Paid orders and invoices preserve the code, type, configured value, eligible merchandise subtotal and actual discount in immutable snapshots. To change or disable a promotion, use a reviewed D1 migration or authenticated operational change that updates `promotions`, records an `admin_audit_log` entry and preserves historical order fields. Date and limit fields exist for future controlled promotions; no expiry or usage limit has been inferred for `SPRING`.
