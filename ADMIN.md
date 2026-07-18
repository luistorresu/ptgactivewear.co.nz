# PTG Activewear Admin

## Scope

The admin portal is available at `/admin` and intentionally contains only:

* Products
* Add Product
* Pictures
* Logout

The public website, cart, checkout, Stripe webhook, contact form, and Resend integration are separate. Existing order, invoice, export, and stock-history API code remains in place for compatibility and historical data, but those complex tools are not shown in the rebuilt portal.

## Storage

* D1 binding `DB`: products, variants, stock, image metadata, orders, order items, stock movements, Stripe events, and audit records.
* R2 binding `PRODUCT_IMAGES`: administrator-uploaded product images and generated thumbnails.
* KV binding `ORDER_EVENT_STORE`: signed-session revocation records and login rate-limit state.
* Checked-in `/photos` assets remain valid fallback catalogue images.

No database migration is required for the rebuilt portal. Existing tables and records are reused without destructive changes.

## Authentication

Required Worker variables and secrets:

* `ADMIN_USERNAME`: the exact login username. It may be a normal environment variable or encrypted secret.
* `ADMIN_PASSWORD_HASH`: encrypted secret in `pbkdf2-sha256$iterations$salt$hash` format.
* `SESSION_SECRET`: encrypted random secret of at least 32 characters.

Passwords are derived with PBKDF2-HMAC-SHA256 and are never stored or compared as plaintext. Sessions use a signed, eight-hour `HttpOnly`, `SameSite=Strict` cookie. Production cookies are also `Secure`. The signed session ID must remain active in KV, so logout immediately invalidates it. State-changing admin requests require an in-memory CSRF token, exact same-origin requests, safe content types, and `X-PTG-Admin-Request: 1`.

Five failed logins for the same username and source address cause a 15-minute lockout. Authentication logs include safe request IDs and outcomes but never passwords, hashes, cookies, tokens, or secrets.

Cloudflare Access can remain in front of `/admin*` and `/api/admin/*` as an additional edge layer. The Worker username/password session is still required behind Access.

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

The Pictures screen supports preview, JPEG/PNG/WebP upload, main-picture selection, gallery ordering, replacement, and deletion. The maximum original upload is 8 MB, 12,000 pixels per edge, and 60 megapixels. The Worker validates file signatures and dimensions rather than trusting extensions.

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

No migration is needed for this rebuild. Deploy only after tests pass and the three authentication variables are present.

## Rollback

Code rollback uses the previous Cloudflare Worker version from **Workers & Pages > ptgactivewear > Deployments**, or reverts the release commit and redeploys it. Because this rebuild has no migration, code rollback does not require a database rollback.

Do not restore a D1 SQL export during a routine code rollback. Restoring an old export can overwrite newer products, orders, and stock movements and is reserved for confirmed data corruption.

If the new login must be disabled urgently, roll back the Worker version. Keep the new credential secrets in Cloudflare until the old version is confirmed healthy, then remove them only if no active version uses them.
