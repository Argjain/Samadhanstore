# Samadhan: security, speed and shopping update

Prepared 7 October 2026. Your live Hostinger website has not been changed.

Use **samadhan-security-speed-ux.zip** for this update. It contains the earlier checkout/category fixes plus the requested items 4, 5 and 6. The old ZIP remains available separately.

## What changed

- **Security:** review ratings accept only 1–5; legacy invalid ratings are excluded from public reviews. Uploaded files are decoded and checked, then saved as safe WebP images; HTML/SVG disguised as an image is rejected. Blog HTML and dynamic search/quiz/product text are handled safely. Password-reset tokens are hashed, single-use and omitted from request logs; resets invalidate other signed-in sessions, including admin sessions. Email templates escape customer text. Production dependency audit reported zero known vulnerabilities on 6 October 2026.
- **Speed:** existing photos receive smaller WebP copies on demand, with a bounded processing queue and persistent cache. Product cards, thumbnails and banners request appropriate sizes. Footer uses the existing small logo. Public navigation data is cached for 30 seconds, API calls avoid navigation queries, combo products are fetched together, search returns at most six matches and shop pages contain at most 24 products. CSS/JavaScript versions prevent stale browser caches.
- **Shopping:** purchase controls appear before expandable long descriptions and benefits; quantity changes immediately update unit price and total. Combo prices explicitly say “each”. Out-of-stock purchase buttons are disabled. Search has a short delay, cancels outdated requests and shows useful feedback. Pagination retains filters. Missing social links are hidden, WhatsApp numbers are normalized, and the footer correctly names Razorpay.
- **Popup:** its JavaScript is byte-for-byte unchanged, including timing and session behavior. It was observed working in the mobile browser check.

## Existing photos and database

Keep the exact existing environment value:

`UPLOAD_DIR=/home/u602842641/domains/samadhanstore.com/uploads`

Do not move or replace that folder. Existing originals are read without being overwritten or deleted. Smaller versions are created under `UPLOAD_DIR/.variants`; the original database image URLs remain valid. New uploads are checked and converted to WebP inside the same external products/banners/combos/blogs folders. App restarts and redeployments do not move them into the code folder. The cache needs write access and consumes additional disk space. The first request for an uncached size includes conversion work; subsequent requests reuse it.

This ZIP contains no uploaded photos, production .env, production SQL dump, or node_modules. Keep your existing private environment variables, database credentials and SESSION_SECRET in Hostinger. Use the included lockfile (`npm ci --omit=dev`) and start with `npm start`.

Startup runs additive migrations: `secure_checkouts` (earlier fix) and `user_security` (session revocation). It does not reset your store. The existing orders/products/coupons/users tables must use InnoDB. Do **not** run `npm run setup-db` on the existing store.

Existing signed-in customers and admins must log in once after this update because old sessions lack the new security version. Password-reset links created by the old application need to be requested again. Newly issued reset links expire after one hour and can be used only once. SMTP still must be configured for email delivery.

## Before uploading to production

1. Make a complete backup of **u602842641_samadhan**, including structure and data, and a separate copy of the full external uploads folder. The previously supplied `u602842641_gitpulse...sql.gz` is not a usable backup of your store.
2. Test this ZIP on a separate staging application with a separate database and a copy of the images. Do not point staging at the live database or live uploads. Use Razorpay test keys there.
3. Match your Hostinger Node 22 runtime in staging. Local tests used Node 24.15.0 and MySQL 8.0.45. The supplied backup did not include the actual Samadhan database schema, so staging compatibility with the real schema is still required.
4. Keep all current Hostinger environment variables. Production requires your existing private `SESSION_SECRET` and absolute `UPLOAD_DIR`; the app will refuse to silently fall back to default values.
5. In Razorpay, configure a webhook for `https://samadhanstore.com/orders/razorpay-webhook`, subscribing to `payment.captured` and `order.paid`. Choose a strong webhook secret and set the same value as `RAZORPAY_WEBHOOK_SECRET` in Hostinger. This is separate from `RAZORPAY_KEY_SECRET`. Use your staging URL and test-mode webhook when testing. Enable/verify automatic payment capture: this application intentionally does not mark merely authorized payments as paid. See [Razorpay webhook validation guidance](https://github.com/razorpay/markdown-docs/blob/master/webhooks/validate-test.md) and [payment webhook guidance](https://github.com/razorpay/markdown-docs/blob/master/webhooks/payments.md).
6. Verify the real `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` and `FAST2SMS_KEY` in Hostinger. The backup contained placeholders. Do not paste passwords or API secrets into chat. Send a test password-reset email and confirm email/SMS delivery on a test order.

## Staging checks, then deployment

- Edit an existing category, including its name, icon, description, sort order and active checkbox. Confirm success and that its existing URL stays stable. Try a duplicate category name and confirm a visible error rather than a server crash.
- Upload a test product photo, redeploy the same staging code, and confirm both old and new images remain visible.
- Check cart and Buy Now separately, including coupons, shipping, zero shipping/online-discount settings and tax. Confirm the Razorpay amount and saved order total agree.
- In Razorpay test mode, complete a payment, retry the success callback, dismiss/reopen checkout, and close the browser after payment. Check that there is one order, stock changes once, and the recovery worker/webhook records the payment.
- Check that anonymous users and another customer cannot open a private order URL. Check the secure guest link works.
- Confirm real provider test notifications and password reset delivery. Admin → Payments shows notification status for online orders.

Once those checks pass and backups are verified, redeploy the ZIP using the same Hostinger application and environment configuration. The ZIP has `package.json` and `server.js` at its root. Install from the included lockfile using the existing Hostinger build flow; startup performs the additive table migration automatically. The start command remains `npm start`.

Schedule the switch when no customers are mid-payment. Payments started under the old application do not have the new saved checkout record and require manual reconciliation in Razorpay if their old callback is interrupted during deployment.

Check runtime logs for `Secure checkout table ready` and `Samadhan listening`, then verify the homepage, admin categories, product images and checkout. Do not change or recreate the external uploads folder.

## Monitoring and rollback

- Check Admin → Payments for `pending` and `review` cases. A `review` case may need replenishment and a payment recheck, or a refund through Razorpay. Refunds are not issued automatically by this update.
- The background worker requires the Node app to be running. Pending orders are retried after restart; webhooks should still be configured. Polling revisits expired checkouts for seven days, while valid webhook deliveries can reconcile older saved checkouts.
- Preserve your previous deployment ZIP. If an urgent rollback is necessary, pause new checkouts and reconcile/release outstanding new reservations first. The old application does not understand the new reservation table; blindly rolling back with reservations outstanding can leave stock held. Never delete `secure_checkouts` to clear a problem.
- Keep both database and uploads backups. Database records and image files are separate parts of the store.


## Additional checks for this update

On staging, confirm product and banner images load both before and after redeployment; upload a JPG/PNG/WebP; verify the old originals still exist. Open the long product page on a phone, check quantity 1 → 2 → 1, and confirm the displayed total matches checkout. Verify the popup still appears. Search by product name, try an empty search and follow page 2 with filters. Review an existing blog post after sanitization: basic headings, paragraphs, lists, links and images remain, while scripts, inline styles, embedded frames and forms are removed.

Test password reset using a real delivery provider on staging with two logged-in browsers, confirming the other browser is signed out after reset. Keep the new user_security table during rollback; do not deploy the older code as a security rollback because it does not enforce session revocation.

## Validation and remaining live checks

45 integration tests passed against disposable local MySQL 8.0.45 with simulated Razorpay. The complete app also passed public/admin page requests, admin login and category editing, forged-image rejection, valid-image upload, optimized-image delivery, persistence after restart, and cross-origin write rejection.

Mobile (375 px) and desktop (about 1366 px) browser checks showed no horizontal overflow. Search returned the expected product, the popup appeared, and quantity 2 showed ₹399 each / ₹798 total, reverting to ₹499 at quantity 1 for the synthetic test product. Test product names/data are local fixtures, not changes to your production catalogue.

14 backed-up homepage images measured 4,557,158 bytes before conversion and 574,776 bytes afterward: 87.4% less image data for the tested card/banner sizes. Original file hashes were unchanged. This is an image-size comparison, not a new Lighthouse score or a claim that the entire page is 87.4% faster.

Local tests used Node 24.15.0. Hostinger Node 22, the actual store schema, live Razorpay capture/webhooks, real email/SMS delivery, and production load/speed still need the staging/live checks above. The supplied SQL archive did not contain the actual Samadhan database. No automatic dependency scan proves that an application has no security issues.
