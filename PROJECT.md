# PTG Activewear Website

## Website

ptgactivewear.co.nz

## Purpose

PTG Activewear is an activewear / sportswear website. The website should look clean, modern, professional, and sporty.

## Local Folder

C:\Users\Nico\Documents\ptgactivewear.co.nz

## Assets

Main image/photo folder:

C:\Users\Nico\Documents\ptgactivewear.co.nz\photos

Current clothing/product images folder:

C:\Users\Nico\Documents\ptgactivewear.co.nz\photos\clouth

Logo files and product images should be checked in these folders first before adding new assets.

## Hosting

The website is hosted/deployed using Cloudflare Pages / Workers.

## Domain

The domain is managed through Cloudflare:

ptgactivewear.co.nz

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

Optional:

* `STRIPE_PUBLISHABLE_KEY` is not currently required because the site uses Stripe-hosted Checkout through the backend.
* `ORDER_EVENT_STORE` should be a Cloudflare KV namespace binding used by the Stripe webhook for idempotency.

Stripe endpoints:

* Checkout session: `POST /api/create-checkout-session`
* Webhook: `POST /api/stripe-webhook`
* Success redirect: `/order-success?session_id={CHECKOUT_SESSION_ID}`
* Cancel redirect: `/cart?checkout=cancelled`

Product prices are controlled server-side in `_worker.js` in the `SERVER_PRODUCTS` catalogue. Frontend display data is controlled in `js/products.js`. Keep both aligned when changing products.

Temporary shipping is controlled in `_worker.js` in `NZ_SHIPPING_RATE`. It is currently marked as test-mode New Zealand shipping and should be updated before production payment launch.

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
6. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`.
7. Reveal the signing secret.
8. Add it to Cloudflare as encrypted secret `STRIPE_WEBHOOK_SECRET`.
9. Redeploy the Worker after adding the secret.

Stripe test payment setup:

1. Add `STRIPE_SECRET_KEY` to the `ptgactivewear` Worker as an encrypted secret using a Stripe test-mode secret key.
2. Do not use live-mode Stripe keys until testing is complete and approved.
3. Use test card `4242 4242 4242 4242` with any future expiry date and any CVC.

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

The production admin is a deliberately simple D1/R2-backed catalogue tool for products, variants, stock, publication state, and product pictures. Existing order, invoice, export, and audit APIs remain available for compatibility and historical records, but the rebuilt portal does not expose those complex workspaces. Authentication uses PBKDF2 password verification, signed expiring `HttpOnly` sessions, KV invalidation, CSRF protection, and login lockout. See `ADMIN.md`.

Paid orders are created only from verified Stripe webhooks. Both encrypted production secrets, `STRIPE_WEBHOOK_SECRET` and `STRIPE_SECRET_KEY`, are configured. Refund event ingestion and automatic idempotent restocking are not yet enabled.

This admin system is an operational order and stock-management tool. It is not a replacement for professional accounting software or statutory tax advice.

## Product Pictures

Product image metadata is stored in D1. Existing checked-in `/photos` files remain the production fallback. Admin uploads use the `PRODUCT_IMAGES` R2 binding and are served through `/product-images/{id}`; the browser never supplies an object key or raw public path.

The R2 bucket name is `ptgactivewear-product-images`. The binding is configured in `wrangler.jsonc`; if it is unavailable, uploads fail without changing image metadata and existing static images continue to work.

New products are saved as safe drafts. Product, variant, starting-stock movement, and audit records are written in one D1 batch. Selected initial images are then uploaded to R2; any failed upload is recoverable from the Pictures workspace without recreating the product.

Active saleable products have canonical `/products/{slug}` pages with Product/Breadcrumb structured data. The dynamic `/sitemap.xml` and `/merchant-feed.xml` endpoints are generated from the same public D1 catalogue.

The Patagonia FC Personalised Mug remains one product with Style 1 and Style 2 variants. Style 1 disallows Player Name and Player Number. Style 2 permits both options at the existing product prices, currently zero dollars; no new fee is inferred.

Public stock labels are `In Stock`, `Only a few left`, and `Out of Stock`. Exact quantities remain admin-only. D1 validates stock at checkout and the verified Stripe webhook performs idempotent deductions.
