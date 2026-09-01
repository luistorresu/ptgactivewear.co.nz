# Changelog

All notable changes to this website should be documented here.

## 2026-09-01

### Changed

* Expanded the Patagonia FC Tournament Fundraising Prize Drawing from 36 to 40 numbers while preserving every existing number and reservation.

## 2026-08-31

### Added

* Added a locally implemented Patagonia FC Tournament Fundraising Prize Drawing page with a responsive, accessible number grid, live D1 availability, single-number selection, progress, sold-out handling, Shop and navigation links, SEO metadata, and all three public themes.
* Added reusable D1 raffle, reservation, number and order tables with atomic reservation and paid-order constraints, plus safe local-only raffle seed data.
* Added a 24-hour Givealittle reservation flow that stores donor details server-side, supplies the exact drawing-number message for the donation note, and directs all drawing payments to the official Givealittle fundraiser.
* Replaced the temporary prize placeholder with the supplied DJI Neo Drone photograph and updated customer-facing, email and admin wording from raffle/ticket to prize drawing/entry while preserving stable internal identifiers.
* Added authenticated Admin Raffles controls to confirm a reserved number as sold after checking Givealittle or release the reservation, with private donor details and audit logging.
* Added drawing race-condition, validation, reservation, manual-confirmation, privacy, theme, navigation and regression coverage.

### Security

* Drawing prices and availability are authoritative in D1, reservations use conditional atomic updates, and only an explicit authenticated admin confirmation commits a reserved number as sold.
* Public drawing responses expose only number statuses; donor contact details remain restricted to authenticated admin workflows.

### Deployment

* Raffle changes, migration and sample data remain local only pending legal and business-detail confirmation. No production migration or deployment was performed.

## 2026-08-19

### Changed

* Changed the `SPRING` promotion from a fixed NZD 20.00 amount to 20% off the Patagonia FC Performance Tracksuit only.

## 2026-08-17

### Added

* Added a reusable D1 promotion model with explicit product eligibility, optional scheduling and usage-limit fields, and immutable paid-order and invoice snapshots.
* Added the `SPRING` promotion for a fixed NZD 20.00 off the Patagonia FC Performance Tracksuit only.
* Added an accessible cart discount-code control with Apply and Remove actions, inline feedback, responsive styling, and Light, Dark and Sky Blue theme support.

### Changed

* Recalculate merchandise discounts, shipping, processing surcharge and final totals authoritatively in integer cents before Stripe Checkout.
* Show applied promotion details in customer and business emails, admin order details, invoices, sales reports and protected CSV exports.

### Security

* Validate promotion codes and explicit eligible product IDs from D1, include promotion state in checkout idempotency fingerprints, and reject Stripe snapshot differences down to one cent.

## 2026-08-14

### Changed

* Replaced the cart's faint icon-only removal control with a clearly labelled, responsive Remove button and confirmation feedback.

## 2026-08-10

### Added

* Split pickup fulfilment into an internal Prepared milestone and a separate customer-facing Ready to Collect action.
* Added a Resend-backed internal Prepared notification sent only to `info@ptgactivewear.co.nz`, with plain-text fallback, durable send state, safe retries, idempotency, and audit events.
* Added Prepared status details and filters to admin orders, reports, and CSV exports.
* Added a protected Mark Completed action for prepared pickup orders that records completion without sending a customer email.

### Changed

* Require pickup orders to be marked Prepared before a customer can receive the Ready to Collect email.
* Preserve historical ready and collected orders with an additive Prepared-state migration.
* Clarified that the Prepared confirmation sends only an internal PTG Activewear notification.

## 2026-08-06

### Added

* Added required Customer Name and Child's Name fields to the cart before checkout, with accessible inline validation and session-only refresh/cancel persistence.
* Added Child's Name to Stripe checkout metadata, paid D1 orders, invoices, fulfilment emails, order emails, admin search and displays, and CSV exports.

### Security

* Child's Name is validated server-side before Stripe Checkout, included in the inventory-reservation fingerprint, HTML-escaped in rendered output, and written to D1 only by the verified payment webhook.
* Added nullable order and invoice columns so historical orders and already-open legacy Stripe sessions remain compatible.

## 2026-08-01

### Added

* Added atomic D1 checkout inventory reservations so concurrent customers cannot pay for the same final unit.
* Added a verified order-status endpoint and payment-confirmation polling before the success page clears the cart.
* Added searchable product selection, selected-product context, image metadata, and editable alt text/style fields to Admin Pictures.
* Added GitHub Actions syntax and regression checks for production-branch changes.

### Changed

* Product cards now use R2 thumbnails while product galleries and lightboxes retain full-size images.
* Improved public page landmarks, skip links, cart focus management, mobile-menu state, control labels, and touch targets.
* Cloudflare Access expiry now restarts secure authentication instead of leaving the admin product selector empty.

### Security

* Checkout attempt IDs are stable across retries, D1 reservations are committed only by verified paid webhooks, and abandoned or failed reservations are released idempotently.
* Delayed Stripe payments retain their reservation until the corresponding success or failure event.
* Picture metadata and reorder JSON bodies now use bounded request readers.

## 2026-07-29

### Changed

* Kept the Patagonia FC Training Kit Player Name and Shirt Number options while removing both $20 personalisation charges from product display, cart, server checkout, Stripe line items, admin orders, invoices, and exports.

## 2026-07-28

### Fixed

* Made the admin Pictures product chooser explicit and reliable, grouped current and archived products, guarded uploads until a product is selected, and preserved per-picture replacement and gallery controls.

## 2026-07-27

### Added

* Added authenticated Ready to Collect, resend, and Mark as Collected actions for eligible paid pickup orders.
* Added a responsive branded Resend email with a plain-text fallback, friendly order number, configured pickup details, and no Stripe references.
* Added durable collection timestamps, email delivery state, provider references, safe errors, email-attempt records, admin audit events, and collection filters.
* Added explicit non-sensitive Training Kit restricted-number verification and availability snapshots to order items and invoices.
* Added authenticated Out for Delivery, resend, and Mark Completed actions for paid delivery orders.
* Added a responsive branded Out for Delivery email plus durable dispatch, completion, delivery-attempt, fulfilment-history, and audit records.

### Security

* Prevent duplicate collection emails with request IDs, a conditional D1 send lock, and Resend idempotency keys.
* Prevent duplicate Out for Delivery emails with the same request-record, send-lock, and provider-idempotency pattern.
* Keep the Birthday Day value transient and excluded from D1, Stripe, emails, invoices, reports, exports, and logs.

## 2026-07-25

### Added

* Added clear Patagonia FC Training Kit shirt-number selection guidance, a 1–99 requested-number range, and restricted rules for numbers 1, 7, 9, and 10.
* Added a transient Day of Birth check for restricted numbers and a signed, expiring server proof that contains no birth-day value.

### Changed

* Renamed Training Kit personalisation displays to Player Name and Shirt Number across the product form, cart, Stripe Checkout, admin orders, emails, invoices, PDF output, and protected exports.
* Marked Training Kit shirt numbers as requests subject to final availability because no allocation or uniqueness system currently exists.

### Security

* Made restricted-number eligibility authoritative at checkout while excluding the entered birth day from cart storage, Stripe metadata, D1 orders, emails, invoices, exports, public pages, and application logs.

## 2026-07-21

### Added

* Added a compact public Light, Dark, and Sky Blue theme selector to every storefront header, with validated `ptg-theme` browser persistence and cross-tab synchronisation.
* Added early theme restoration before public styles render, theme-aware logo switching, accessible native controls, and coordinated public design tokens.
* Added a lightweight transparent classic football SVG that moves slowly between random positions inside public headers, behind the interactive controls, with responsive sizing, tab-hidden pausing, non-interactive layering, and a reduced-motion fallback.

### Changed

* Applied the selected public theme to storefront surfaces, typography, forms, product cards, galleries, cart, fulfilment controls, alerts, and footer without changing the admin portal.

### Fixed

* Kept single-image product lightboxes in the full-width centre gallery column when previous and next controls are hidden.

## 2026-07-20

### Added

* Added a protected, responsive `/admin/reports` workspace with paid-sales summaries, search, date/status/fulfilment/product filters, pagination, order links, and filtered sales/invoice CSV downloads.
* Added durable D1 invoice snapshots with unique `PTG-INV-YYYY-NNNNNN` numbering, preserved item/pricing/customer details, and refund-status synchronisation.
* Added report indexes, 366-day query limits, 5,000-row export limits, no-store responses, parameterised report SQL, and spreadsheet-formula-safe CSV output.

### Changed

* Added the concise `PTG Activewear order` description to new Stripe payments instead of relying on a long technical PaymentIntent ID.

## 2026-07-19

### Added

* Added `www.ptgactivewear.co.nz` as a Cloudflare Worker custom domain with a permanent path-preserving redirect to the canonical root domain.
* Added an explicit cart choice between free training-centre pickup and NZ$5.00 New Zealand delivery, with customer guidance to review item selections before secure payment.
* Added server-calculated fulfilment snapshots across Stripe Checkout, D1 orders, confirmation emails, admin order details and filters, CSV exports, and HTML/PDF invoices.
* Added NZ-only Stripe shipping collection for delivery and address-free pickup handling with configurable collection instructions.
* Added additive D1 fields for fulfilment method, pickup details, structured NZ delivery address, phone, and rural-delivery flags.
* Added a configurable, server-calculated card processing surcharge with a pre-Stripe cart breakdown and one separate Stripe line item.
* Added additive D1 order snapshots for surcharge configuration and cumulative refund amounts.
* Added protected admin order list/details with surcharge, total, refund, and invoice visibility.
* Added surcharge details to order emails, CSV exports, HTML/print-to-PDF invoices, and Stripe metadata.
* Added local endpoint and responsive visual smoke tests for checkout summaries.

### Security

* Reject missing or manipulated fulfilment choices, enforce free pickup and NZ-only delivery server-side, and preserve shipping as an immutable paid-order snapshot.
* Recalculate every checkout total from trusted catalogue data, use integer cents, reject one-cent webhook mismatches, and use Stripe idempotency keys for repeated Checkout Session requests.
* Restrict enabled surcharge sessions to card payments and retain a 4% code-level safety limit.

### Operations

* Configured the production surcharge at 2.65% plus NZ$0.30 but left it disabled pending account-specific pricing confirmation and a surcharge-free online payment option.

## 2026-07-18

### Changed

* Replaced the complex admin dashboard with a focused Products, Add Product, and Pictures portal while preserving the public website and existing D1 data.
* Replaced Resend email-code admin sign-in with PBKDF2 username/password verification, signed eight-hour `HttpOnly` sessions, KV invalidation, CSRF protection, and temporary login lockout.
* Added explicit publish, unpublish, archive, restore, and guarded permanent-delete admin endpoints.
* Simplified product creation into clear Save as Draft and Publish Product workflows with recoverable sequential image uploads.

### Fixed

* Allowed draft and archived products to remove their final picture while preventing active products from becoming pictureless.
* Made picture deletion restore R2 objects if its D1 mutation cannot commit and made primary/reorder changes atomic with their audit entries.
* Added request IDs and structured safe logs to admin authentication, product changes, and picture operations.
* Aligned PBKDF2 password derivation with Cloudflare Workers' 100,000-iteration WebCrypto limit and made unsupported hash formats fail closed.

### Testing

* Added behavioral authentication tests and a reusable local/live admin integration flow covering login, CSRF, product validation, variants, stock, lifecycle, JPEG/PNG/WebP uploads, idempotent retries, galleries, public catalogue visibility, safe deletion, public-page regressions, and logout.

## 2026-07-17

### Added

* Added the Patagonia FC Training Kit at NZD $95 with training shirt, shorts, socks, four size options, player-name and player-number personalisation, a five-image gallery, and Product SEO data.

### Changed

* Updated the Patagonia FC Windbreaker Jacket to NZD $95 and active sizes 8, 10, 12, and XS, while retaining superseded variant rows for historical order integrity.

## 2026-07-16

### Added

* Added a D1-backed homepage product carousel for all active saleable products, with autoplay, manual controls, touch swipe, keyboard navigation, stock status, lazy loading, and reduced-motion support.
* Added upload request IDs and an additive D1 uniqueness constraint so repeated image-upload requests are idempotent.

### Changed

* Made Draft and Active an explicit status choice when creating a product, with an image required before immediate publication.
* Reduced and repositioned product lightbox controls, added a focus trap, and restored focus to the opening control when closed.
* Added image preflight details, progress text, timeout handling, decoder fallback, structured server diagnostics, and versioned R2 image URLs.

### Fixed

* Fixed picture-upload errors appearing in the hidden product dialog instead of the Pictures dialog.
* Fixed submitting while client-side image optimisation was still running and prevented duplicate concurrent uploads.
* Made R2 and D1 image writes retry-safe, with cleanup when a database commit fails.

## 2026-07-15

### Added

* Added the Patagonia FC Windbreaker Jacket at NZD $120 with XS-2XL options, three gallery images, full product details, and water-resistant usage guidance.
* Replaced the Patagonia FC mug gallery with clear new Style 1 and personalised Style 2 images while preserving style-specific options.
* Added complete draft product creation with slug, SEO metadata, variants, SKUs, starting stock, personalisation controls, and recoverable multi-image R2 uploads.
* Added D1-backed public product URLs with Product and Breadcrumb structured data, dynamic sitemap entries, and a Google Merchant-compatible XML feed.
* Added safe product enable, disable, archive, restore, delete-as-archive, and draft duplication workflows to the admin catalogue.
* Added drag-and-drop product image ordering, crop presets, WebP optimisation, generated thumbnails, and thumbnail-aware R2 storage cleanup.
* Added storefront canonical links, social preview metadata, structured data, `robots.txt`, and `sitemap.xml`.
* Added consistent storefront and admin security headers at the Worker asset boundary.

### Changed

* Polished the admin catalogue, dashboard, sidebar, tables, status filtering, and responsive picture workflow without changing the storefront design direction.
* Replaced unverified homepage trust statements and dead footer links with factual service and Stripe checkout information.
* Converted the Luchito and Contact hero backgrounds to compact WebP assets while preserving the original source images.

### Fixed

* Fixed Add Product creating only an empty product shell by creating product, variant, initial stock, and audit records in one D1 batch before optional image uploads.
* Hid archived products from public catalogue and checkout availability while preserving order and audit history.
* Updated the Patagonia FC Beanie with separate With Pom Pom and Without Pom Pom variants and matching galleries.

## 2026-07-14

### Added

* Added separate Patagonia FC Beanie options for With Pom Pom and Without Pom Pom, using their matching style galleries.
* Added the production R2 binding declaration required by admin product-picture uploads.
* Added an admin workflow for creating safe inactive draft products, with server-generated IDs and direct access to variants, stock, and picture management.
* Added an additive D1 migration for R2 image metadata, active/static fallbacks, style galleries, and variant-level personalisation rules.
* Added an authenticated Admin Pictures workspace and validated R2 upload API with controlled image delivery, previews, upload progress, alt text, primary selection, ordering, replacement, removal, and audit records.
* Added Style 1 and Style 2 to the existing Patagonia FC mug product with style-specific galleries and personalisation visibility.
* Added a reduced-motion-safe bulk-order banner to the Shop page.
* Created transparent light/dark PTG logo derivatives and a refreshed favicon while preserving source logo files.

### Changed

* Updated product galleries to the upgraded checked-in imagery while preserving one product record per item and the static fallback architecture.
* Removed raw image-path editing from the normal admin form and backend product mutation allowlist.
* Removed Stripe IDs from main order tables and added masked, collapsed admin-only payment technical details.
* Updated customer emails to use only friendly PTG order numbers and moved technical references to the internal business email footer.
* Improved invoice actions and preserved selected mug style across cart, Stripe metadata, D1 orders, admin details, emails, invoices, and CSV data.

### Fixed

* Fixed admin picture requests falling through to the general API router and made mobile draft creation show progress and visible validation errors.
* Removed redundant Worker asset rewrites that caused redirect loops on the clean `/cart` and `/order-success` routes.

### Notes

* Cloudflare R2 must be enabled on the account before the `ptgactivewear-product-images` bucket and `PRODUCT_IMAGES` binding can be created. Static images continue to work until then.

## 2026-07-13

### Added

* Added a local Cloudflare D1 schema and safe seed for products, variants, image galleries, inventory, orders, order items, stock movements, Stripe events, and admin audit history.
* Added a Cloudflare Access JWT-protected admin portal and API for catalogue editing, variant management, stock adjustments, paid orders, fulfilment, dashboard metrics, and stock history.
* Added public D1 product endpoints with low-stock and out-of-stock states while preserving the existing static catalogue fallback.
* Added D1 checkout stock validation and atomic paid-order/inventory processing with durable webhook idempotency.
* Added local-development tooling, automated security/checkout tests, and admin migration/rollback documentation.
* Created and seeded the production D1 catalogue and bound the production KV event/session store.
* Added approved-email admin sign-in using Resend one-time codes and secure, expiring `HttpOnly` sessions.
* Added a persisted optional dark theme for the admin portal without changing the public storefront.
* Added additive order/invoice schema fields, transaction-safe invoice sequencing, fulfilment history, order search/filters, internal notes, richer dashboard metrics, protected A4 invoice printing, and authenticated CSV exports.
* Configured the production Stripe webhook and encrypted signing secret for verified paid-order ingestion.

### Security

* Added server-side Access audience/email validation, approved-email session validation, same-origin admin mutation checks, parameterised SQL, input allowlists, optimistic update guards, non-negative stock constraints, and protected backend assets.

### Fixed

* Allowed the admin sign-in page to load its dedicated stylesheet and login script while keeping dashboard assets and admin APIs protected.
* Improved dark-theme contrast across admin tables, forms, badges, dialogs, navigation, and responsive layouts.
* Declared non-secret Resend routing variables in Wrangler configuration so GitHub-connected deployments preserve contact and admin-code email delivery.

### Notes

* Deployed the D1-backed catalogue and editable admin portal to the live Worker after explicit approval. Cloudflare Access remains optional; the live portal currently uses Resend one-time-code authentication.

## 2026-07-12

### Fixed

* Removed an unsupported Stripe Checkout parameter that prevented sessions from being created.
* Added safer Stripe error diagnostics and omitted empty product metadata from Checkout requests.
* Enabled live Stripe Checkout after explicit approval while keeping server-side product validation.

## 2026-07-05

### Changed

* Prepared Stripe-hosted Checkout in the Cloudflare Worker with server-side product validation, NZD pricing, customisation add-ons, shipping configuration, success/cancel pages, and verified webhook email handling.
* Updated the homepage and About page story copy to reflect PTG Activewear's premium custom apparel services for clubs, schools, academies, businesses, and teams.
* Removed the homepage hero CTA buttons and centered the Our Story section after removing the statistics panel.
* Connected the homepage newsletter form to Cloudflare email endpoints using the existing Resend email environment variables.
* Updated the Contact form to use one direct backend `Send Message` button with no form mailto fallback.
* Polished the Shop page product grid with larger cards, larger images, premium spacing, and hover carousel image transitions.
* Set `info@Ptgactivewear.co.nz` as the main website contact email in the footer.
* Polished header and footer logo presentation using the main PTG logo.
* Centered and balanced footer content across pages.
* Added the Luchito image background to the About page hero with dark overlays for readability.
* Added a Contact page with a contact image hero, email CTA, and site navigation links.
* Added separate `Send` and `Open Email` actions to the Contact page message form.
* Added a Cloudflare Pages contact form endpoint prepared for server-side email sending.
* Updated the live product list to the five requested Patagonia FC products.
* Added product image galleries and a zoom lightbox for product angles.
* Merged duplicate product image angles into single product galleries and removed unapproved products from the visible catalogue.
* Updated live product prices and descriptions from the merchandise PDF.
* Added the Luchito image as the homepage hero background with a dark readability overlay.
* Added a subtle reduced-motion-safe fade-in for the Luchito homepage hero background.
* Added a favicon generated from the PTG logo.

## 2026-07-02

### Added

* Centralized product data in `js/products.js`.
* Rendered homepage and shop product cards from the shared product list.
* Added size selectors for products.
* Limited name and number personalization to shirts and jerseys.

### Planned

* Add logo professionally to the website header.
* Update header to black background with white text.
* Add optional product personalisation:

  * Add your name (+$20.00)
  * Add your number (+$20.00)
* Update website product pictures from:
  C:\Users\Nico\Documents\ptgactivewear.co.nz\photos\clouth
* Keep only the current PTG Activewear product list on the website.

### Notes

* Confirm whether the +$20.00 add-ons are fully connected to checkout pricing or only shown/stored as product options.
