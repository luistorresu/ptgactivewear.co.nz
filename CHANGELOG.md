# Changelog

All notable changes to this website should be documented here.

## 2026-07-14

### Added

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
