# Homebound — Updated Files (November 11, 2026)

This version updates `index.html`, `css/styles.css`, `js/app.js`, `js/supabase-service.js`, and `supabase/schema.sql`. The remaining files (`js/config.js`, `js/demo-data.js`, `js/tailwind-config.js`) are **unchanged** and should stay in your original Homebound VS Code project.

## Install the update

1. In your existing `homebound-vscode` folder, **replace only the five code files listed above**. Keep their exact relative paths.
2. Open `index.html` using the VS Code Live Server extension (an HTTP server, not double-clicking the file). Online resources (Tailwind CDN, Font Awesome, Leaflet, Chart.js and Supabase JS) require internet.
3. If you use Supabase, open your project’s **SQL Editor** and run the **entire updated** `supabase/schema.sql`. It creates the new storage bucket, hold requests, conversation messages, secure RPCs, additional listing notes, and optional map coordinates, while preserving existing listings. Run it as the project administrator, not from the website.
4. Confirm that `js/config.js` still contains your Supabase Project URL and **publishable / anon** key. Never put a service-role/secret key in browser JavaScript. Approved landlords continue to authenticate via Supabase Auth and the `public.landlords` table. For testing without a Supabase project, leave the existing `js/config.js` credentials blank to use local preview mode (`admin123` to access the owner portal).
5. Reopen Live Server and test a student inquiry, owner reply, hold request, hold approval/cancellation, drag-and-drop images, and the Analytics → Print Report view.

## What's new

- Compact hero with **“Where comfort meets convenience.”**; free-text location/landmark query; budget filter and Reset only.
- Room details stay visible when opening the owner chat drawer.
- Hold requests accept both a **date and custom time**, track their status, allow student cancellation, and appear in the owner Visits tab. In configured Supabase mode these are stored in `public.hold_requests` and protected by token-specific RPCs. The 24-hour request period does **not** guarantee rental inventory is exclusively reserved. Owners must confirm requests and prevent double booking themselves.
- The assistant responds to **student listing discovery** or **owner management** depending on the active portal. This is a rule-based assistant, **not** a paid AI/API-backed chatbot.
- Listing editor accepts any address string (not a fixed location zone), removes coordinate entry, accepts file drag/drop or file selection for main/room images, uses whole-peso price inputs and amenity checkboxes/custom amenity tags, and stores optional property/room notes. New rooms automatically start Available. Existing room status is preserved on edits and remains toggleable via My Listings.
- Owner dashboard now includes **Student Messages** and an owner reply composer. In Supabase mode, conversations and messages are actually saved, scoped to the property owner; student chat reads require an unguessable per-browser conversation token. A student must keep the same browser storage to reopen the conversation. In local preview mode, conversation messages are only in memory during that tab session.
- Analytics use accessible listing, visitation and chat records, with four visual charts, KPIs, recommendations and a property-level performance table. In local preview mode, original sample visitations/payments are still example records; no fabricated historical charts are presented as real data.
- The print stylesheet prints **only Analytics & Recommendations** (with a formal report heading), not the surrounding owner dashboard or other pages.
- Sticky header remains visible during page scrolling; modal dialogs cover it as appropriate.

## Supabase database details

- `public.listings` holds the property + rooms JSON and now includes `note`; `lat` and `lng` remain in the schema for **older map pins** but are optional/hidden in the form. Newly added properties without verified coordinates are still visible in the property list and search but will not have Leaflet map pins automatically. Use a geocoding/geospatial service of your choice for automatic pins; none is hard-coded in this release.
- `public.landlords` retains administrator approval and Row Level Security (RLS).
- `storage.buckets` includes a public-read `listing-images` bucket; authenticated **approved** landlords can upload in their own UUID folder, up to 5 MB per JPEG/PNG/WEBP image. Uploaded image URLs are stored with property records. If a listing save fails after photos upload, the uploaded files may remain in Storage; remove such unused images manually.
- `public.hold_requests` stores student PII (name, phone, email), desired date and time, status, expiry and secret request token. Anonymous students can create, read and cancel only via approved token-based RPCs, not via public table SELECT. Only the listing owner can see their requests and confirm/decline them.
- `public.chat_conversations` and `public.chat_messages` store student-to-owner messages. The conversation token acts as a capability secret, so treat browser storage as sensitive. Messages/holds can be abused without request-rate limiting; add CAPTCHA/rate limiting and privacy notices before a public deployment. Add retention/deletion policies for personal data.
- Supabase Realtime is enabled for listings, holds and messages. The student conversation also polls every seven seconds while open to fetch replies (it does not claim to be end-to-end encrypted).
- The Payments tab still previews SMS actions; no money transfers or SMS messages are sent without a separately configured provider.

## Verify this update

When Supabase is configured, you can check actual writes in the Supabase **Table Editor**:

- New/edited properties: `public.listings`.
- A submitted hold: `public.hold_requests` → `Pending Approval`. Approve/decline from the owner dashboard; cancel from the student’s Hold Status modal.
- A student chat: `public.chat_conversations` and `public.chat_messages`. A signed-in property owner sees only their property's conversations and can reply.
- Uploaded photographs: Storage → `listing-images` → `<landlord-UUID>/<random-file-name>`.

### Important

This update has been **JavaScript syntax checked** and its HTML element/function references were cross-checked. An actual live Supabase test was not possible without your project credentials, and the browser sandbox available for automated visual testing blocked navigation, so test the flows in VS Code Live Server after installation. The `schema.sql` is an **administrative database migration** and must be applied before using new Supabase features.