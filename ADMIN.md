# PTG Activewear Admin

## Scope

The admin portal is available at `/admin` and contains:

* Products
* Add Product
* Pictures
* Orders
* Reports
* Logout

The public website, cart, checkout, Stripe webhook, contact form, and Resend integration are separate. The Reports workspace is available at `/admin/reports` with authenticated sales summaries, search, filters, pagination, and CSV exports.

## Storage

* D1 binding `DB`: products, variants, stock, checkout reservations, image metadata, orders, order items, stock movements, Stripe events, and audit records.
* R2 binding `PRODUCT_IMAGES`: administrator-uploaded product images and generated thumbnails.
* KV binding `ORDER_EVENT_STORE`: signed-session revocation records and login rate-limit state.
* Checked-in `/photos` assets remain valid fallback catalogue images.

The admin uses additive migrations only. Existing tables and records are preserved.

Paid orders include the required checkout Child's Name in D1 and show it in the dashboard, order details, collection/delivery workflows, invoice view, reports, search, and CSV exports. Historical orders created before migration `0020_order_child_name.sql` display `Not recorded` where appropriate and remain valid.

## Authentication

Required Worker variables and secrets:

* `ADMIN_USERNAME`: the exact login username. It may be a normal environment variable or encrypted secret.
* `ADMIN_PASSWORD_HASH`: encrypted secret in `pbkdf2-sha256$iterations$salt$hash` format.
* `SESSION_SECRET`: encrypted random secret of at least 32 characters.
* `PAYMENT_SURCHARGE_ENABLED`: non-secret production feature flag.
* `PAYMENT_SURCHARGE_PERCENT`: non-secret percentage with at most two decimal places.
* `PAYMENT_SURCHARGE_FIXED_CENTS`: non-secret fixed NZD cents component.
* `PAYMENT_SURCHARGE_LABEL`: non-secret customer-facing label.
* `PAYMENT_SURCHARGE_DESCRIPTION`: non-secret customer-facing explanation.

Passwords are derived with PBKDF2-HMAC-SHA256 at Cloudflare Workers' supported 100,000-iteration limit and are never stored or compared as plaintext. Sessions use a signed, eight-hour `HttpOnly`, `SameSite=Strict` cookie. Production cookies are also `Secure`. The signed session ID must remain active in KV, so logout immediately invalidates it. State-changing admin requests require an in-memory CSRF token, exact same-origin requests, safe content types, and `X-PTG-Admin-Request: 1`.

Five failed logins for the same username and source address cause a 15-minute lockout. Authentication logs include safe request IDs and outcomes but never passwords, hashes, cookies, tokens, or secrets.

The hardened authentication flow supports three explicit modes:

* `legacy`: signed Worker username/password sessions only. This remains the default until Access is verified.
* `transition`: a valid Cloudflare Access identity is preferred, with the signed Worker session retained as rollback protection.
* `access`: only a cryptographically verified Cloudflare Access JWT is accepted. Local login is disabled.

Access JWTs are accepted only after verifying the RS256 signature against the account's Access signing keys, issuer, configured audience, expiry, subject, and an allowlist containing exactly three email addresses. State-changing requests also require exact same-origin validation, a safe content type, and `X-PTG-Admin-Request: 1`.

## Cloudflare Access Transition

Do not set `ADMIN_AUTH_MODE=access` until Email OTP has been tested successfully for every approved administrator.

1. In Cloudflare Zero Trust, enable **One-time PIN** as an authentication method.
2. Create a self-hosted Access application covering both `ptgactivewear.co.nz/admin*` and `ptgactivewear.co.nz/api/admin*`.
3. Add one **Allow** policy whose include rule lists only the three approved email addresses. Do not use `Everyone`, an email-domain rule, or OTP login method alone as the allow rule.
4. Record the Access team domain and Application Audience tag.
5. In the Worker variables, set `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and `ADMIN_AUTH_MODE=transition`. `CF_ACCESS_AUD` may contain a comma-separated list only if Cloudflare requires separate applications for the two paths.
6. Keep `ADMIN_ALLOWED_EMAILS` restricted to exactly the three approved addresses already recorded in project configuration.
7. Verify that an approved address receives its six-digit OTP, can enter the portal, and can perform a read-only admin request. Verify that an unapproved address is denied.
8. Set a separate encrypted `SHIRT_NUMBER_PROOF_SECRET` before removing `SESSION_SECRET`.
9. After preview and production verification, change to `ADMIN_AUTH_MODE=access`. Remove the legacy username/password secrets and code only in a later deployment with a tested rollback point.

Cloudflare Access must protect both the browser pages and the admin API. Protecting only `/admin*` leaves `/api/admin*` exposed to direct requests.

## Create Credentials

Generate a production password hash without printing the plaintext password:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\hash-admin-password.ps1
```

Generate a session signing secret:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-session-secret.ps1
```

Add the values in Cloudflare under **Workers & Pages > ptgactivewear > Settings > Variables and Secrets**. Store `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` as encrypted secrets. Do not commit production values to `.dev.vars`, `wrangler.jsonc`, GitHub, HTML, or browser JavaScript.

Keep `PAYMENT_SURCHARGE_ENABLED=false` until the Stripe account's payment-fee report has been reviewed and a surcharge-free online option is available where feasible. The Worker rejects negative values, malformed decimals, fixed fees above NZ$100, and percentages above 4%. Configuration changes are recorded by Cloudflare deployment history; this project does not have a D1-backed admin settings system.

## Fulfilment Configuration

Pickup and delivery settings are protected Worker environment values rather than browser-editable values. `PICKUP_PRICE_CENTS` must remain `0`; `NZ_DELIVERY_PRICE_CENTS` is `500`; and `NZ_DELIVERY_COUNTRY` must remain `NZ`. Checkout fails closed if these values are malformed.

The production pickup location is currently named `Training Centre`, but its street address is intentionally blank because no confirmed address is stored in the project. Set `PICKUP_ADDRESS_LINE_1`, `PICKUP_ADDRESS_LINE_2`, `PICKUP_CITY`, and `PICKUP_POSTCODE` after the business confirms the collection address. Until then, customers are told that PTG Activewear will contact them when the order is ready and confirm collection details.

Delivery addresses are collected by Stripe Checkout and restricted to New Zealand. No separate address-autocomplete provider or API key is configured. Manual Stripe-hosted address entry is the supported fallback.

## Local Development

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Set local-only values for `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and `SESSION_SECRET`.
3. Generate the hash and secret with the scripts above.
4. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
   ```

5. Open `http://127.0.0.1:8787/admin`.

`.dev.vars` is ignored by Git. There is no local authentication bypass.

Run automated checks:

```powershell
npm run check
npm test
```

Run the mutation integration flow against a disposable local Wrangler database:

```powershell
$env:PTG_ADMIN_BASE_URL='http://127.0.0.1:8787'
$env:PTG_ADMIN_USERNAME='your-local-username'
$env:PTG_ADMIN_PASSWORD='your-local-password'
node .\tests\admin-integration.mjs
```

## Product Workflow

* Drafts can be created without a variant or picture and do not appear publicly.
* Publishing requires at least one active variant and one active picture.
* New-product publishing is recoverable: D1 first saves one draft product and its variants atomically, then pictures upload to R2, then the publish endpoint enables it. A failed picture upload leaves one editable draft rather than creating duplicates.
* Slugs and SKUs are unique. Price and stock are non-negative and validated server-side.
* Product edits use optimistic versions. Variant stock changes write `stock_movements` and audit entries.
* Ordinary product updates cannot accept raw image paths.

## Picture Workflow

The Pictures screen supports searchable product selection, selected-product confirmation, preview, JPEG/PNG/WebP upload, main-picture selection, gallery ordering, replacement, deletion, and alt-text/style editing. The maximum original upload is 8 MB, 12,000 pixels per edge, and 60 megapixels. The Worker validates file signatures and dimensions rather than trusting extensions.

R2 object keys are UUID-based and generated only on the server. Upload request IDs make retries idempotent. If an R2 write succeeds but D1 fails, the new R2 object is removed. Picture removal snapshots R2 objects before deletion and restores them if D1 cannot commit. An active product cannot lose its final picture; unpublish it first.

## Archive And Delete

Archive is the normal removal action. Archived products remain in D1, stay out of the public catalogue, preserve order history, and can be restored as drafts.

Permanent deletion is accepted only when the product:

* is archived;
* has no order items;
* has no stock movements; and
* has no active pictures.

The backend rejects unsafe deletion with an explanation. Historical orders and stock records are never deleted.

## Backup And Deployment

Before deployment, record the current Worker version and export D1 when the active Cloudflare token has D1 read permission:

```powershell
wrangler deployments list --name ptgactivewear
wrangler d1 export ptgactivewear-catalog --remote --output C:\Users\Nico\Documents\ptgactivewear-backups\ptgactivewear-d1-YYYYMMDD-HHMMSS.sql
```

Apply pending additive migrations only after a successful export. Deploy only after tests pass and the three authentication variables are present.

## Orders, Invoices And Reports

Tracked stock is reserved atomically in D1 before Stripe Checkout is created. A verified paid webhook commits the reservation to the new order; failed, expired, or abandoned attempts release it idempotently. Delayed payments remain reserved until Stripe reports success or failure. Checkout Session IDs, Stripe event IDs, Payment Intent IDs, and browser checkout-attempt IDs are unique or idempotently handled, so concurrent checkouts and duplicate webhook delivery cannot create another order or deduct stock twice.

The Stripe webhook must subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, and `charge.refunded`. The Worker also lazily releases abandoned reservations before cart summary and checkout validation as a fallback for an expired-event delivery delay.

Invoice creation assigns a unique `PTG-INV-YYYY-NNNNNN` number and stores a durable JSON snapshot plus searchable invoice totals in D1. Product edits do not alter the stored snapshot. Refund webhooks update the invoice refund status and refunded amount without replacing its original item and pricing details.

Reports and exports require the signed admin session. Queries are parameterised, capped at 100 rows per browser page and 5,000 rows per CSV, and date ranges are limited to 366 days. CSV cells beginning with spreadsheet formula characters are safely prefixed. Admin responses and downloads use `Cache-Control: no-store`.

Invoices are rendered from the private D1 snapshot and are never exposed through a public URL. `Print / Save PDF` uses the browser print dialog; no separate PDF object is retained in R2. The D1 snapshot is the recoverable source from which another PDF can be generated.

Orders and invoices have no automatic deletion policy. Before schema changes, export D1 to the external `ptgactivewear-backups` folder. Restore an export only for confirmed corruption and only after preserving the newer database first.

## Pickup Collection Workflow

Paid pickup orders with a valid customer email expose `Mark Ready to Collect & Send Email` in the authenticated order-details view. The action marks the order `ready_for_collection`, sends a branded customer email through Resend, and records the delivery result, fulfilment history, and admin audit event. A sent message can be resent only through the separate confirmed resend action. `Mark as Collected` is available only after the order is ready and the first email was sent.

The Worker prevents double sends with a per-order send lock, unique request records, disabled browser controls, and Resend idempotency keys. Failed provider requests leave the order ready but do not mark the email as sent.

Collection email addresses are assembled from `PICKUP_ADDRESS_LINE_1`, `PICKUP_ADDRESS_LINE_2`, `PICKUP_CITY`, and `PICKUP_POSTCODE`. Production currently has no confirmed street address in these fields, so the email omits the address block until the business configures them. Do not invent an address.

## Delivery Completion Workflow

Paid delivery orders expose `Mark Out for Delivery & Send Email` in the authenticated order-details view. The action changes the fulfilment status to `out_for_delivery`, sends a branded customer email through Resend, and records the dispatch timestamp, delivery result, fulfilment history, and admin audit event. A sent message can be resent only through the separate confirmed resend action.

`Mark Completed` closes a paid delivery order and records the completion timestamp and administrator. It may be used after dispatch or directly for a historical order that was already delivered before this workflow existed. Pickup orders continue to use `Mark as Collected` instead.

The Worker prevents duplicate dispatch messages with unique request records, a conditional D1 send lock, disabled browser controls, and Resend idempotency keys. Failed provider requests leave the order out for delivery without falsely marking the email as sent.

## Rollback

Code rollback uses the previous Cloudflare Worker version from **Workers & Pages > ptgactivewear > Deployments**, or reverts the release commit and redeploys it. Additive invoice/report tables and indexes may remain in place during a code rollback.

Do not restore a D1 SQL export during a routine code rollback. Restoring an old export can overwrite newer products, orders, and stock movements and is reserved for confirmed data corruption.

If the new login must be disabled urgently, roll back the Worker version. Keep the new credential secrets in Cloudflare until the old version is confirmed healthy, then remove them only if no active version uses them.
