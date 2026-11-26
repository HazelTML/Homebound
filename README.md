Homebound — November 2026 revision package
This package contains only the code files changed to implement the 20 revisions in the user's five-page review document. It continues the existing one-landlord / many-listings model. This is an upgrade to the existing Homebound project, not a replacement project.
Replace / add the files
Keep the same folders in your current VS Code project:
homebound-vscode/
├── index.html                         REPLACE
├── css/
│   └── styles.css                     REPLACE
├── js/
│   ├── app.js                         REPLACE
│   ├── supabase-service.js            REPLACE
│   ├── homebound-extras.js            ADD (new file)
│   ├── config.js                      KEEP as-is
│   ├── demo-data.js                   KEEP as-is
│   └── tailwind-config.js             KEEP as-is
└── supabase/
    └── schema.sql                     REPLACE, then run in Supabase
The HTML already loads the new homebound-extras.js after app.js, so do not remove that script tag. Do not create a second app.js. CSS and Supabase service need to be replaced together with HTML and app JS.
Apply the database migration safely
1. In the existing Homebound Supabase project, make a backup/export of important data before making schema changes. No new project is needed.
2. Open Supabase → SQL Editor → New query.
3. Copy and run the entire updated supabase/schema.sql file (which contains the existing schema plus additive changes). Do not run it against an unrelated database. If any error appears, stop and copy the actual error; do not delete or recreate tables to fix it.
4. Run this in a new query if needed: NOTIFY pgrst, 'reload schema';.
5. Refresh the Homebound webpage, sign in with the single approved landlord's email and password, and test on a newly created property before modifying real rental records.
The migration introduces tenant_announcements, tenant_announcement_recipients, advance_reservations, and adds planned_end_date / announcement_token fields to tenancies. Existing hold_requests, listing records, chat records, prior rent history and manually stored image URLs are intended to remain untouched. Functions are updated to enforce bed capacity, room occupancy and reservation permissions. Live Supabase execution and RLS behavior must still be tested in your own project.
Quick feature testing
1. Student home: Confirm minimal banner, location search, budget filter, and map; select a property and open Inspect Room. Check the owner's contact number and the campus distance estimate after selecting a destination.
2. Visitation: Select an 08:00–20:00 one-hour slot or type a start time in HH:00; submit the existing hold. Keep hold updates distinct from an advance reservation.
3. Owner property editor: Check required phone, red required asterisks, location suggestions and manual pin, photos and independent bed-slot toggles. Try editing an existing property with manually stored image URLs; the intended behavior is to preserve the links when photos are unchanged.
4. Dashboard: Verify compact overview metrics, a single-column property inventory that expands down, payment status as plain text, and actions represented by labeled icons (hover / keyboard focus).
5. Messages: Compare student and owner chat designs; on a narrow screen ensure inbox, AI and owner chat do not obscure each other.
6. Tenant announcements: From the new Announcements tab, select All Active Tenants or a particular listing. Publish a test notice. In the Rent Tracker, copy a tenant's private updates link and open it in a private browser tab. A link must be shared with the tenant; this feature does not send SMS, email, or push notifications automatically. Keep private links secure.
7. Upcoming vacancies and advance reservations: On an active tenancy, record an expected move-out date; its public listing should show only an approximate future availability date, never tenant details. A student can send a separate advance request for a later move-in date. The owner can approve, decline or cancel it from the new tab. An approval holds the bed's future allocation and must not automatically end the active tenant, charge money, or change visitation holds.
8. Analytics: Use Overview, Student Demand, Rent & Forecast, and By Property selectors. Verify historical monthly dues and estimated future contracted rent are clearly differentiated. Print should include only the formal analytics report.
Important boundaries
- Forecasts are projections from existing tenancy and payment schedules, not guarantees of payments received or statistical predictions of demand.
- Campus proximity shows estimated straight-line distance and a walking-time approximation; mountain terrain, actual roads, traffic and entrances can make the journey significantly longer.
- Address suggestions use the public Photon demo geocoder. Internet access is required and availability is not guaranteed; typed addresses and manual map pinning remain available. Replace the geocoder with an appropriate contracted service before high-traffic public use.
- Tenant announcements use private unguessable links rather than automatic delivery. Rotate/revoke tokens before production if you need stronger access-lifecycle controls, and share links only with the intended tenant.
- Advance requests are subject to landlord review and are independent of short 24-hour visitation requests. An approved request is not itself a tenancy agreement or completed payment.
- Image uploads still depend on Supabase Storage permissions, valid Supabase credentials and internet access. Existing manual image URLs are not migrated or deleted by this package.
- The app may behave in demo mode when Supabase is not configured. Demo data is not permanent storage.
Checks completed
- JavaScript syntax validation: all changed JS files passed node --check.
- HTML: all element IDs unique; existing inline function handlers resolve.
- Browser-level smoke tests in demo mode: page initialization, compact listing expansion, hourly visit slots, owner phone validation, tenant assignment, expected move-out, targeted announcements, student upcoming-vacancy indicators, advance request approval, and mobile chat exclusivity passed with no JavaScript errors.
- Not verified: running the migration against your real Supabase instance; a live Storage image upload; external Photon availability on your network; real signed-in cross-device announcement/reservation notifications.