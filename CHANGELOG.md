# Changelog

All notable changes to this website should be documented here.

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
