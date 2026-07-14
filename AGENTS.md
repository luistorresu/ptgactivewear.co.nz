# AGENTS.md

## Project

This repository is for the website ptgactivewear.co.nz.

## Important Rules

* Only make changes that I specifically request.
* Do not redesign unrelated sections of the website.
* Do not remove existing content, product data, images, styling, or functionality unless I clearly ask.
* Keep changes small, safe, and easy to review.
* Before editing, inspect the current project structure and understand how the site is built.
* Preserve the existing coding style, folder structure, naming conventions, and design direction.
* Do not commit, push, deploy, or change Cloudflare/GitHub settings unless I explicitly ask.
* After every task, summarize:

  * What files were changed
  * What was changed
  * How to preview/test locally
  * Any limitations or follow-up items

## Website / Deployment

* Domain: ptgactivewear.co.nz
* Hosting/deployment: Cloudflare Pages / Workers
* Source control: GitHub
* Local folder: C:\Users\Nico\Documents\ptgactivewear.co.nz
* Image folder: C:\Users\Nico\Documents\ptgactivewear.co.nz\photos

## Design Preferences

* Keep the website clean, modern, sporty, and professional.
* Use a black/white theme where appropriate.
* Header should look professional, with black background and white text.
* Logo should look clean and readable on a black header.
* Do not distort images or logos.
* Keep everything responsive for mobile and desktop.
* Product pictures should look clean, premium, smooth, and professional.
* Use smooth hover/transition effects for product images where appropriate.

## Product Page Rules

* Product personalisation options may be added when requested.
* Name and number add-ons should be optional.
* If pricing add-ons are requested, clearly confirm whether the extra cost is fully connected to checkout/cart pricing or only displayed/stored.
* Preserve cart and checkout behaviour.

## Testing

* Run the appropriate local checks if available, such as:

  * npm install, only if dependencies are missing
  * npm run dev
  * npm run build
  * npm run lint, if configured
* Do not install new dependencies unless necessary and approved.

## Admin And Inventory

* Cloudflare D1 is the source of truth for products, variants, stock, orders, and stock movements after the approved cutover.
* Keep `js/products.js` as the documented migration fallback until D1 has been tested and production removal is explicitly approved.
* Never expose exact stock, admin identity configuration, customer data, or order data through public APIs.
* Protect `/admin*` and `/api/admin/*` with Cloudflare Access and server-side JWT/email validation.
* Use Stripe test keys for local and staging admin/inventory work. Do not change production payment mode without explicit approval.
* Do not apply remote D1 migrations, seed production, create Cloudflare resources, or deploy the admin system without explicit approval.
