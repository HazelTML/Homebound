# HOMEBOUND — Complete Code Reviewer

A consolidated study guide for the seven submitted code files, prepared for project review and defense. Each chapter retains the original reviewer explanations, examples, questions and answers, and oral review.

## Table of contents
1. [Part 1 — `index.html`](#part-1) — HTML structure and user interface
2. [Part 2 — `css/styles.css`](#part-2) — Custom styling and responsive design
3. [Part 3 — `js/tailwind-config.js`](#part-3) — Theme and visual identity
4. [Part 4 — `js/config.js`](#part-4) — Supabase connection settings
5. [Part 5 — `js/supabase-service.js`](#part-5) — Backend communication
6. [Part 6 — `js/app.js`](#part-6) — Application logic and user interactions
7. [Part 7 — `schema.sql`](#part-7) — Database architecture and business rules

## How to study this reviewer

The chapters are arranged in dependency-oriented learning order: interface, styling, configuration, database communication, application logic, and database implementation. This is not an exact script execution order. `index.html` loads Tailwind before its theme configuration, and loads the Supabase SDK, `config.js`, `demo-data.js`, `supabase-service.js`, then `app.js` near the end of the body. `schema.sql` is executed separately in Supabase SQL Editor to provision the backend. `demo-data.js` is referenced but was not among the seven submitted files.

| Layer | Responsibility |
|---|---|
| HTML | Defines what users see |
| CSS and Tailwind configuration | Controls appearance and responsive layout |
| Configuration | Supplies Supabase connection settings |
| Supabase service | Translates and sends data requests |
| Application JavaScript | Handles interactions, rendering and workflows |
| SQL schema | Defines persistence, access rules and database operations |

> Line references in each chapter refer to its original source file, not this combined README. This is a static code review; the application and database have not been tested. The original source code is unchanged.

---

<a id="part-1"></a>

## Part 1 — `index.html`: HTML structure and user interface

> Source: first submitted HTML file (approximately 805 lines). Referred to as `index.html` for review purposes; the original filename was not supplied.

### 1.1 What is this file for?

This HTML file is the main structure of HOMEBOUND, a rental information and property management platform. It defines what students and landlords see and interact with: navigation, search filters, maps, listing cards, dashboards, chat windows, and forms.

**Remember:** HTML defines the interface; CSS controls appearance; JavaScript controls behavior; Supabase provides backend services. This file connects these layers but does not itself implement database operations or business logic.

### 1.2 Quick map of the code

| Approx. lines | Section | Purpose |
|---|---|---|
| 1–28 | Document head | Loads libraries, fonts, configuration and styles |
| 30–77 | Navigation | Portal switching, connection status, hold alerts, toast messages |
| 79–137 | Student portal | Location/budget search, Baguio map, rental listings |
| 139–216 | Owner dashboard | Add listing button and five overview statistics |
| 218–389 | Owner tabs | Requests, rent tracking, listings, messages, analytics |
| 391–403 | Student inbox | Floating message button and unread count |
| 405–453 | AI assistant | Prompt input and recommendation window |
| 455–490 | Owner chat | Direct messages and visitation updates |
| 492–577 | Room preview | Images, prices, capacity, amenities and room selection |
| 579–633 | Hold request form | Student contact details and preferred visitation schedule |
| 635–664 | Hold status | Request list, next steps and cancellation |
| 666–696 | Owner authentication | Demo passcode or landlord account interface |
| 699–742 | Tenant assignment | Specific property, room, bed and rental agreement details |
| 744–795 | Listing editor | Property details, map pin, images and room editor |
| 797–805 | Scripts | Loads Supabase and local JavaScript files in order |

### 1.3 Libraries and connected files

| Library/file | Responsibility |
|---|---|
| Tailwind CSS | Utility classes for layout, colors, spacing and responsive design |
| Font Awesome 6.4.0 | Icons such as beds, messages and calendars |
| Leaflet 1.9.4 | Interactive property map and location pin interface |
| Chart.js | Charts for owner analytics |
| Google Fonts (Inter) | Website typography |
| `js/tailwind-config.js` | Tailwind configuration, including expected custom brand styling |
| `css/styles.css` | Custom styles |
| Supabase JS SDK v2 | Client library for communicating with Supabase |
| `js/config.js` | Settings layer, as indicated by script-order comment |
| `js/demo-data.js` | Sample data layer |
| `js/supabase-service.js` | Database service layer |
| `js/app.js` | Application behavior layer |

The last five scripts load in dependency order: SDK → settings → sample data → database service → application. Their actual contents are not included in this submission, so their internal behavior is not yet verified.

### 1.4 Student portal

| Feature | Important HTML ID / handler | What to remember |
|---|---|---|
| Location search | `filterLocation` / `applyFilters()` | Free-text search for city, street, campus or landmark |
| Budget filter | `filterPriceRange` / `applyFilters()` | Any budget, up to ₱3,000, ₱3,000–5,000, ₱5,000–10,000, ₱10,000+ |
| Reset | `resetFilters()` | Requests clearing the filters |
| Property map | `map` | Container for Leaflet map; pin interaction is delegated to JS |
| Listing results | `listingsGrid`, `listingCount` | JavaScript fills the grid and updates the matching count |
| Room preview | `modalBedspaceViewer` | Shows selected room images, price, capacity and amenities |
| Ask owner | `openChatFromModal()` | Opens the owner inquiry chat through JS |
| Request hold | `openPreHoldForm()` | Opens the visitation and 24-hour hold form |
| Hold updates | `activeHoldBanner`, `studentHoldList` | Displays request summaries and individual requests |

#### Student workflow

Search/filter → select listing or map pin → inspect room → ask owner or submit hold request → check request status and messages.

The hold form collects name, phone, email, visitation date and time. `holdVisitTime` uses a text input with an HH:MM pattern. `normalizeVisitTimeInput(this)` runs when focus leaves the field. The form advertises visiting hours of 08:00–20:00, but the HTML pattern only validates a 24-hour time format; enforcing those visiting hours requires additional logic. A hold request is subject to owner confirmation, not a guaranteed reservation.

### 1.5 Owner portal

`ownerPortalView` starts with the `hidden` class. The owner button invokes `attemptOwnerLogin()` and the authentication form invokes `verifyOwnerPasscode(event)`. The HTML includes a demo passcode hint and a hidden landlord email field for account mode. Actual authentication, refresh behavior and database access protection must be reviewed in JavaScript and backend code; hiding an element is not a security mechanism.

#### Five dashboard statistics

| Statistic | ID | Meaning |
|---|---|---|
| Rooms available | `statOccupancy` | Availability from room records, not verified physical occupancy |
| Contracted monthly rent | `statRevenue` | Agreed rent of active tenants, not collected cash |
| Pending visits | `statPendingVisits` | Requests awaiting review |
| Active holds | `statActiveHolds` | Student hold requests |
| Overdue payments | `statOverdueCount` | Overdue rent monitoring |

Some initial numbers (such as 3 pending visits and 2 active holds) are hardcoded placeholders. The actual values depend on application logic.

#### Five management tabs

| Tab | What it contains | Important container |
|---|---|---|
| Visitations & holds | Student information, target room, requested schedule, status and actions | `adminVisitationsTable` |
| Payment tracker & SMS alerts | Tenant records, rent dues, active/ended and payment status filters | `adminPaymentsTable` |
| My property listings | Property inventory and availability management interface | `adminListingsContainer` |
| Student messages | Conversation list, selected chat and reply form | `ownerConversationList`, `ownerChatMessages` |
| Seasonal influx & analytics | KPIs, charts, recommendations and printable property report | `tabContentAnalytics` |

`switchAdminTab()` selects a tab. The payment filters invoke `renderAdminTables()` to request an updated view. Rent tracking is explicitly **not payment collection**; reminder previews do not send SMS. The tenant register describes keeping active and ended tenancy records, including dates and payment history.

### 1.6 Listing creation and tenant assignment

#### Listing editor (`modalListingEditor`)

- Property title, type (Dormitory, Bedspace, Apartment), address, landmark, owner/contact details and optional notes.
- `listingPinMap` provides a place to select the property's coordinates; `clearListingPin()` removes the selected pin through JS.
- `listingMainDrop` accepts drag-and-drop or selected JPG, PNG and WEBP files. The stated maximum is 5 MB, and uploads are described as occurring when saving. The `accept` attribute helps filter file selection; size, actual format, upload and storage checks require implementation beyond this HTML.
- `addListingRoom()` requests a new room editor. `listingRoomEditor` is populated dynamically. The interface describes creating individual bed slots from capacity and protecting occupied slots.
- `saveListing(event)` handles form submission in JavaScript.

#### Tenant assignment (`modalTenantAssignment`)

The owner selects a property, specific room and individual bed, then enters tenant name, phone, optional email, move-in date, monthly due day (1–31) and agreed rent.

`updateTenantRoomChoices()` is called on property change; `updateTenantRoomRate()` is called on room change; `submitTenantAssignment(event)` handles submission. The intended result is occupying the selected bed and starting monthly rent tracking. Actual database updates and prevention of conflicting assignments cannot be confirmed from HTML alone.

### 1.7 Messaging and AI assistant

| Component | Purpose | Key handlers |
|---|---|---|
| Student inbox | Property conversations and unread badge | `toggleStudentInbox()` |
| Live owner chat | Questions and visitation updates | `sendLiveChatMessage()`, `sendQuickMessage()`, `closeLiveChat()` |
| Owner inbox | Read and reply to student conversations | `loadOwnerInbox()`, `sendOwnerReply(event)` |
| AI assistant | Context-aware recommendations interface | `toggleAIChat()`, `sendCustomAIPrompt()` |

The AI assistant is distinct from human-to-human chat. This HTML does not identify an AI model, API, recommendation algorithm or messaging transport.

### 1.8 Analytics

| Canvas ID | What the chart represents |
|---|---|
| `chartSeasonalInflux` | Student conversations created per month |
| `chartRoomShare` | Current room availability by property type |
| `chartPriceBands` | Number of rooms in advertised rent bands |
| `chartHoldOutcomes` | Pending, approved, declined and cancelled requests |

`analyticsKpis` and `analyticsRecommendations` are dynamic containers. `analyticsPropertyRows` holds property performance summaries. `printAnalyticsReport()` requests printing. The report states its figures are limited to records accessible to the landlord; advertised rates are not actual revenue.

### 1.9 HTML concepts you should know

| Concept | Example | Explanation |
|---|---|---|
| `id` | `id="listingsGrid"` | Unique identifier JS can target |
| `class` | `class="hidden"` | Styling or behavior hook; Tailwind hidden removes display |
| `onclick` | `onclick="resetFilters()"` | Runs a JS function on click |
| `oninput` | `oninput="applyFilters()"` | Runs while the user changes the input |
| `onchange` | `onchange="renderAdminTables()"` | Runs when a value changes and is committed |
| `onsubmit` | `onsubmit="saveListing(event)"` | Calls JS when the form submits |
| `required`, `min`, `max`, `pattern` | Due day 1–31 | Browser-side input constraints, not backend validation |
| `aria-label`, `aria-live` | Hold alerts and map pin status | Accessibility information for assistive technology |
| `md:`, `lg:` | `md:grid-cols-2` | Responsive Tailwind styles applied at specified breakpoints |
| `<canvas>` | Analytics charts | Drawing surface used by Chart.js |
| `z-50`, `fixed` | Modal positioning | Controls stacking and placement |

#### Read a code snippet in plain English

```html
<input id="filterLocation" type="search" oninput="applyFilters()">
```

This creates a search input named `filterLocation`. Whenever its value changes through user input, JavaScript calls `applyFilters()`. The search algorithm itself is elsewhere.

```html
<form id="listingEditorForm" onsubmit="saveListing(event)">
```

This defines the listing form and passes the submission event to the JavaScript handler. It does not save data by itself.

### 1.10 What is not proven by this file?

- Live data persistence, realtime updates, authorization and row-level security.
- Actual hold expiration, approval/cancellation and message delivery.
- AI recommendation logic, file upload validation, bed-slot synchronization and analytics calculations.
- The visitations tab contains a prototype-only notice, while other interface labels refer to live data. Whether that notice is replaced in live mode needs verification in the JavaScript.

These are review boundaries, not claims that the features are broken.

### 1.11 Possible defense questions and answers

**Q: Why does HOMEBOUND use a single HTML file for two portals?**  
A: Both interfaces are defined in the same document, with the owner view initially hidden. JavaScript handlers control which portal is displayed and initiate owner authentication.

**Q: How does the search feature work?**  
A: The HTML supplies location and budget inputs and invokes `applyFilters()` when they change. JavaScript implements the matching and rendering logic.

**Q: Why are some containers empty?**  
A: They are placeholders for dynamic content such as property listings, messages and analytics, which JavaScript populates.

**Q: What is bedspace granularity?**  
A: Managing individual bed slots within a room rather than only tracking the room as a whole. The assignment interface lets the owner select an exact slot.

**Q: Does the payment tracker accept online payments?**  
A: No. The interface describes rent monitoring and manual payment verification, plus previewing suggested SMS reminders.

**Q: What is the difference between AI chat and live chat?**  
A: The AI interface is intended for recommendations; live chat is for communication between students and the landlord.

**Q: Does hiding the owner portal secure it?**  
A: No. Real access control must be enforced by authentication and backend authorization.

**Q: Why is Supabase loaded before app.js?**  
A: The application may depend on the SDK, configuration and service functions, so those scripts are loaded first.

**Q: What makes the interface responsive?**  
A: The viewport meta tag and Tailwind breakpoint classes let layouts adapt to different screen widths.

**Q: How are analytics displayed?**  
A: HTML defines the report containers and chart canvases. Chart.js provides chart rendering; application logic must calculate and supply the data.

### 1.12 One-minute oral review

HOMEBOUND's HTML serves as the foundation of the user interface. It contains a student portal for searching rental accommodations, viewing property locations, inspecting rooms, requesting holds and communicating with the landlord. It also contains an owner portal for managing listings, visitations, tenant assignments, rent records, messages and analytics. Tailwind CSS handles most styling, Leaflet provides the map interface, and Chart.js supports visual reports. JavaScript connects the interface to application logic, while Supabase is the intended backend service. The HTML defines the elements and event handlers, but the actual data processing, authentication and persistence are handled outside this file.

**Key takeaway:** HTML = structure and interaction entry points, not the implementation of the application's business logic.

---

<a id="part-2"></a>

## Part 2 — `css/styles.css`: Custom styling and responsive design

**File reviewed:** `css/styles.css` (inferred from the stylesheet linked in Part 1)

### 2.1 Main purpose

CSS (Cascading Style Sheets) controls how the website looks and adapts to different screens and printing. This file supplements Tailwind CSS with custom styles for navigation, maps, forms, image upload areas, room previews, messaging and analytics reports.

**Remember:** HTML creates the elements, CSS styles them, JavaScript controls their behavior, and Supabase handles database-related services when connected.

### 2.2 Quick code breakdown

| Selector / section | Purpose |
|---|---|
| `html` | Smooth scrolling when supported scroll actions occur. |
| `.glass-nav` | Translucent white navigation with a blurred background. |
| `.site-header` | Keeps navigation at the top while scrolling; stacking level 40. |
| `.modal-backdrop` | Darkens and blurs the background behind a popup. |
| `#map` | Gives the property map a 340px height, rounded corners and stacking level 1. |
| `::-webkit-scrollbar*` | Customizes scrollbar width, track, thumb and hover color in supporting browsers. |
| `.input-editor` | Standardizes form field size, spacing, borders and text. |
| `.input-editor:focus` | Shows a green outline when a field receives focus. |
| `.image-dropzone` | Creates the dashed image upload area with hover/focus feedback. |
| `.image-file-input` | Styles the file input and its choose-file button. |
| `.price-no-spinner` | Hides native number-input arrows while allowing numeric entry. |
| `.analytics-panel` | Styles report cards, headings and descriptions; discourages page breaks inside cards. |
| `#liveChatDrawer` | Limits chat width to the viewport minus 24px. |
| `#liveChatMessages` | Contains scroll chaining when reaching the end of the messages. |
| `@media (min-width:900px)` | Adjusts room preview layout when owner chat is open on wider screens. |
| `@media (max-width:640px)` | Adjusts banner, chat drawer, room preview and hold alert for mobile screens. |
| `@page` and `@media print` | Formats the analytics report for A4 printing. |

### 2.3 Important CSS concepts

```css
.input-editor { width: 100%; border-radius: .65rem; }
#map { height: 340px; }
.input-editor:focus { outline: 2px solid #16a34a; }
```

- `.` selects a class, which can be reused across elements.
- `#` selects an element by its ID.
- `:focus` is a pseudo-class describing an element's current state.
- `::file-selector-button` is a pseudo-element targeting the file input's button.
- `rem` is relative to the root font size; `px` is a CSS pixel; `vw` and `vh` are relative to viewport width and height.
- `calc()` calculates a CSS value; `min()` chooses the smallest supplied value.
- `!important` gives a declaration extra cascade priority; it is used here particularly for mobile and print overrides.
- `z-index` controls stacking within applicable stacking contexts; it does not guarantee an element sits above every other element on the page.

### 2.4 Feature-by-feature explanation

#### Navigation and modals

```css
.site-header { position: sticky; top: 0; z-index: 40; }
.modal-backdrop { background: rgba(15,23,42,.62); backdrop-filter: blur(4px); }
```

The header stays at the top within its scrolling context. The modal backdrop separates a popup visually from the page. CSS does not authenticate users or open the modal by itself.

#### Property map

`#map` provides a visible 340px-high container for the Leaflet map. The map's markers, location and click behavior are controlled elsewhere, not by this stylesheet.

#### Landlord forms and image uploads

The `.input-editor` class keeps fields consistent across listing and tenant assignment forms. `.image-dropzone` uses a dashed border and changes to green when hovered or when an element inside receives focus. The file selector button is styled separately.

**Important:** CSS does not read files, validate file size, upload images or save image URLs. The HTML calls `handleImageDrop()` and `handleImageSelection()`; their implementations must be reviewed in JavaScript. Styling cannot fix an empty-file upload error by itself.

#### Room preview and owner chat

```css
@media (min-width:900px) {
    #modalBedspaceViewer.chat-side-open {
        justify-content: flex-end;
        padding-left: 350px;
    }
}
```

When the room viewer has the `chat-side-open` class, the wide-screen layout shifts the preview to the right to make room for chat. The dialog width is also limited. JavaScript must manage that class; CSS does not decide when chat is open.

| Screen width | Custom behavior |
|---|---|
| 900px and above | Room preview shifts right when chat is open. |
| 641–899px | Neither of these two custom breakpoint blocks applies; base styles and Tailwind still apply. |
| 640px and below | Chat drawer stretches between 12px side margins, becomes 280px tall; room preview shifts upward and is capped at 64vh when chat is open. Hold banner is width-limited to 130px. |

The mobile hold banner clips overflowing content; this may hide some controls or text and should be tested on narrow screens.

#### Printable analytics report

```css
@page { size: A4; margin: 14mm; }
@media print {
    body * { visibility: hidden !important; }
    #tabContentAnalytics, #tabContentAnalytics * {
        visibility: visible !important;
    }
    .print-hide { display: none !important; }
}
```

Print styles aim to show only the analytics report, hide print controls, use readable borders and fonts, reduce chart height and preserve chart colors. `break-inside: avoid` requests that report panels remain together where possible. Browser print settings and available page space can affect the result.

The HTML references `printAnalyticsReport()`. CSS formats the print output but does not initiate printing or calculate analytics. An ancestor hidden with `display: none` can still prevent report visibility, so the print action and layout need testing together.

### 2.5 How the files connect

| HTML element / class | CSS responsibility | Behavior handled elsewhere |
|---|---|---|
| `#map` | Container dimensions | Leaflet initialization and property pins |
| `.image-dropzone` | Upload area appearance | File selection, drag-and-drop and upload |
| `#modalBedspaceViewer` | Room preview positioning | Opening the preview and managing chat state |
| `#liveChatDrawer` | Responsive chat sizing | Opening chat and sending messages |
| `#activeHoldBanner` | Mobile width and clipping | Request status and dismissal |
| `#tabContentAnalytics` | Print presentation | Calculating analytics and triggering printing |

### 2.6 Possible defense questions and answers

**Q1. Why use custom CSS if HOMEBOUND already uses Tailwind?**  
Tailwind handles general utility styling, while custom CSS handles specialized reusable styles, responsive chat layouts, scrollbar customization and print formatting.

**Q2. How does HOMEBOUND support mobile screens?**  
Media queries apply different styles based on viewport width. At 640px and below, the chat drawer and room preview are resized or repositioned for smaller screens.

**Q3. How can students view the room while chatting with the owner?**  
The `chat-side-open` class activates responsive positioning rules that make space for chat while retaining the room preview. JavaScript must manage the actual open and close states.

**Q4. Does the CSS handle image uploading?**  
No. It styles the drop zone and file selector. JavaScript and the storage service must perform file handling and uploading.

**Q5. How is the analytics report prepared for printing?**  
The print media query isolates the report visually, hides controls and adjusts its typography, charts and borders. The page rule requests A4 paper with 14mm margins.

**Q6. Why hide number-input spinners?**  
To simplify the appearance of numeric fields and favor direct typing. This does not remove the input's numeric validation.

**Q7. Why use a green focus outline?**  
It provides a visible indication of the currently focused input, supporting usability, including keyboard navigation.

**Q8. What happens if the stylesheet is removed?**  
HTML and JavaScript can still exist, and Tailwind can still supply its own styles, but the custom visual rules, specialized responsive layout and print formatting would be lost.

### 2.7 One-minute oral review

The HOMEBOUND stylesheet supplements Tailwind CSS by defining specialized visual styles for the website. It controls the sticky navigation, modal backgrounds, property map dimensions, landlord forms and image upload area. It also uses media queries to adjust the room preview and chat layout for desktop and mobile screens, allowing students to review a room while communicating with the owner when the appropriate chat state is applied. For the landlord, it includes print-specific rules that format the analytics report for A4 paper. This stylesheet focuses on appearance and layout, while JavaScript manages functionality and Supabase provides database services. It does not directly upload files, send messages or calculate analytics.

### 2.8 Quick memorization guide

- **CSS = appearance and layout**
- **Class = reusable styling; ID = targeted element**
- **Media query = conditional layout**
- **900px = desktop chat-side layout**
- **640px = mobile layout**
- **Print media = analytics report formatting**
- **A4 / 14mm = requested print page settings**

---
Scope: This reviewer is based on the submitted CSS and the HTML from Part 1. No source code was changed or executed. Actual upload, chat, authentication and analytics behavior cannot be verified from CSS alone.

---

<a id="part-3"></a>

## Part 3 — `js/tailwind-config.js`: Theme and visual identity

### 3.1 File overview

This file customizes Tailwind CSS to give HOMEBOUND a consistent visual identity. It defines the default sans-serif font and two custom color palettes: `brand` (green) and `navy` (dark blue-gray).

**Remember:** This file defines design settings, not application logic or database operations.

### 3.2 Code structure

| Section (lines) | Purpose |
|---|---|
| 1–3 | `tailwind.config`, `theme`, and `extend`: configure and extend Tailwind's existing theme. |
| 4–6 | `fontFamily.sans`: prefer Inter, with a generic sans-serif fallback. |
| 7–15 | `colors.brand`: define six green shades. |
| 16–19 | `colors.navy`: define two dark blue-gray shades. |
| 20–22 | Close the nested configuration objects (line numbering approximate). |

### 3.3 Understanding the configuration

```js
tailwind.config = {
    theme: {
        extend: {
            // Custom fonts and colors
        }
    }
}
```

- `tailwind.config`: the configuration object used by the Tailwind browser script in this project.
- `theme`: controls design values such as fonts and colors.
- `extend`: adds custom values while retaining the existing default theme utilities.
- `fontFamily` and `colors`: organize the specific design settings.

### 3.4 Font configuration

```js
fontFamily: {
    sans: ['Inter', 'sans-serif'],
}
```

When an element uses `font-sans`, Tailwind uses Inter if available. Otherwise, the browser uses a sans-serif fallback. The configuration does not download Inter; the HTML loads it through Google Fonts.

### 3.5 Custom color palette

| Color token | Hex code | Example use |
|---|---|---|
| `brand-50` | `#f0fdf4` | Very light green background |
| `brand-100` | `#dcfce7` | Light green badge |
| `brand-500` | `#22c55e` | Accent or focus ring |
| `brand-600` | `#16a34a` | Primary action button |
| `brand-700` | `#15803d` | Darker hover state or text |
| `brand-900` | `#14532d` | Deep green text or background |
| `navy-800` | `#1e293b` | Dark blue-gray surface |
| `navy-900` | `#0f172a` | Darker blue-gray surface |

The uses above are examples, not mandatory rules. Lower shade numbers are lighter in these palettes. The numbers are names, not opacity percentages. No `brand-200`, `brand-300`, `brand-400` or `brand-800` is defined here.

### 3.6 How HTML uses these settings

```html
<button class="bg-brand-600 hover:bg-brand-700 text-white">
    Save Listing
</button>
```

| Class | Meaning |
|---|---|
| `bg-brand-600` | Green background using the custom palette. |
| `hover:bg-brand-700` | Darker green when the pointer hovers. |
| `text-white` | White text from Tailwind's default palette. |
| `font-sans` | Use the configured sans-serif font stack. |
| `focus:ring-brand-500` | Green focus-ring color. |

The button's styling does not save anything; JavaScript handles the action.

### 3.7 How the files connect

```text
index.html
  ├── Tailwind CDN script (loads Tailwind)
  ├── Google Fonts (loads Inter)
  ├── tailwind-config.js (defines theme values)
  └── styles.css (adds custom CSS rules)
```

The submitted configuration assumes the global `tailwind` object already exists. In the previously submitted HTML, the Tailwind script is loaded before the configuration. HTML and dynamically generated JavaScript markup can both use the custom utility classes.

### 3.8 Important distinction: configuration vs CSS

| `tailwind-config.js` | `styles.css` |
|---|---|
| Defines reusable theme tokens. | Defines explicit CSS rules. |
| Enables utilities such as `bg-brand-600`. | Styles elements such as `#map` and `.image-dropzone`. |
| Centralizes the brand palette. | Handles custom layouts, media queries and print styles. |

Changing a theme token affects utilities that reference that token. It does not automatically update hard-coded hex colors in `styles.css` or change default `slate-*` utilities.

### 3.9 Important findings and limitations

- Earlier submitted HTML and JavaScript use `brand-200`, `brand-300`, `brand-400` or `brand-800` in places, but this configuration does not define those shades. Unless defined elsewhere, those custom utilities will not have the intended colors. Review the palette and usages together.
- The `navy` palette is separate from Tailwind's default `slate` palette; defining it does not replace `slate`.
- The font and color configuration is not responsible for responsiveness, authentication, rental calculations or database security.
- This is a static code review; browser rendering and external dependency loading have not been tested.

### 3.10 Possible defense questions and answers

**Q1. What is the purpose of `tailwind-config.js`?**  
It centralizes custom theme settings, specifically HOMEBOUND's font and color palettes.

**Q2. Why use `extend`?**  
It adds custom settings while retaining existing Tailwind theme values, allowing both custom and default utilities to be used.

**Q3. Why use custom color names instead of repeated hex codes?**  
Reusable names improve visual consistency and make global theme changes easier for elements using those tokens.

**Q4. What is the difference between `brand-600` and `brand-700`?**  
They are two different green shades; the latter is darker and can be used for hover states.

**Q5. Why is `sans-serif` included after Inter?**  
It is a fallback if Inter is unavailable.

**Q6. Does this file load the Inter font?**  
No. It specifies the preferred font; the HTML imports the font.

**Q7. How is this different from the main CSS file?**  
This file customizes Tailwind's design tokens, while the main CSS file contains explicit styling rules and custom layouts.

**Q8. Does changing a color affect Supabase or the application's functions?**  
No. It affects visual presentation, not data storage or business logic.

### 3.11 One-minute oral review

The `tailwind-config.js` file is responsible for customizing HOMEBOUND's Tailwind CSS theme. It uses `theme.extend` to add the Inter font and custom green and navy color palettes without replacing Tailwind's existing default theme. These settings allow us to use reusable utility classes such as `bg-brand-600` and `hover:bg-brand-700` across the student and landlord interfaces. This makes the design more consistent and easier to maintain. The file focuses only on visual theme settings; the main CSS file provides additional styling, JavaScript handles functionality, and Supabase manages backend data.

### 3.12 Quick memorization guide

| Keyword | Remember it as |
|---|---|
| `tailwind.config` | Tailwind settings |
| `theme` | Design values |
| `extend` | Add without replacing defaults |
| `fontFamily.sans` | Inter with fallback |
| `brand` | Green palette |
| `navy` | Dark blue-gray palette |
| `hover:` | Style on pointer hover |
| `bg-` / `text-` | Background / text color |

**Core takeaway:** Define design values once, reuse them across the interface.

*Original code unchanged. Filename inferred from the earlier HTML script reference.*

---

<a id="part-4"></a>

## Part 4 — `js/config.js`: Supabase connection settings

### 4.1 File overview

This file contains the connection settings used by HOMEBOUND to identify its Supabase project. It does not directly retrieve, insert, update, or delete database records. Those operations belong to the database service and application logic.

**Remember:** `config.js` tells the application where to connect and which public API key to use.

### 4.2 Simplified code

```javascript
window.HOMEBOUND_CONFIG = {
  SUPABASE_URL: 'YOUR_PROJECT_URL',
  SUPABASE_PUBLISHABLE_KEY: 'YOUR_PUBLISHABLE_KEY'
};
```

The actual project URL and key have been replaced with placeholders in this reviewer for clarity. Your original code is unchanged.

| Code | Explanation |
|---|---|
| `/* ... */` | Multi-line comment containing setup and security instructions. JavaScript does not execute it. |
| `window` | Browser global object, allowing other scripts on the page to access the configuration. |
| `HOMEBOUND_CONFIG` | Custom object holding the connection settings. |
| `SUPABASE_URL` | Identifies the Supabase project and its API endpoint. |
| `SUPABASE_PUBLISHABLE_KEY` | Public-facing API key intended for use in browser applications. |
| `{ ... }` | Object containing named properties and their values. |

### 4.3 How it connects to other files

```text
index.html loads the Supabase SDK
              ↓
config.js defines connection settings
              ↓
supabase-service.js uses settings to communicate with Supabase
              ↕
app.js requests data and updates the interface
```

The previously submitted HTML loads the SDK before `config.js`, followed by `demo-data.js`, `supabase-service.js`, and `app.js`. This order makes the configuration available before the application uses it.

This file alone does not create a Supabase client or establish a successful network connection.

### 4.4 Live mode versus demo mode

| Live mode | Demo mode |
|---|---|
| Project URL and publishable key are supplied. | Settings are left blank, as described in the code comments. |
| Intended to use Supabase for actual records. | Intended to use local in-memory sample records. |
| Requires valid settings, network access, and appropriate backend permissions. | Does not require a Supabase connection; external libraries may still require internet access. |

The mode-selection logic is implemented elsewhere, not in this configuration object. Demo data is not necessarily preserved after a reload.

### 4.5 Security concepts

- **Publishable key:** Designed to be visible in browser code. It identifies the application to Supabase; it does not authenticate an individual landlord or grant unrestricted database access.
- **Row Level Security (RLS):** Database policies control which rows a client may access or modify. Enable RLS and configure appropriate policies for exposed tables.
- **Authentication:** Verifies the identity of a user, such as an approved landlord. It is separate from the publishable key.
- **Authorization:** Determines what that user is allowed to do through database policies and other backend access controls.
- **Service role or secret key:** Must never be included in this browser file. Privileged keys can bypass RLS and belong only in trusted server-side environments.

A publishable key is safe for its intended browser use only when the backend access controls are correctly configured. This file cannot prove that RLS is enabled or that the policies are secure.

### 4.6 Possible defense questions and answers

**Q1. What is the purpose of `config.js`?**

It centralizes the Supabase project URL and publishable API key so other scripts can use a consistent configuration.

**Q2. Why is the configuration separated from `app.js`?**

It makes connection settings easier to maintain and allows the application to be configured for a different Supabase project without changing its main application logic.

**Q3. Why use `window.HOMEBOUND_CONFIG`?**

It exposes the configuration as a browser global that other scripts loaded on the page can read.

**Q4. Is the publishable key a landlord password?**

No. It is an application API key. Landlord identity must be verified separately through authentication.

**Q5. Why is a publishable key allowed in the frontend?**

It is designed for public clients. Proper database permissions and RLS policies, not hiding the key, protect restricted records.

**Q6. What happens if both configuration values are blank?**

The code comments indicate that HOMEBOUND is intended to use demo mode with sample records. The service and application scripts implement that behavior.

**Q7. Can this file alone save tenant information?**

No. It only defines settings. The service must make a database request, and the backend must authorize and execute it.

**Q8. Can another landlord deploy HOMEBOUND with a different database?**

The configuration can point to another Supabase project. That project must also have the required schema, policies, storage and authentication setup. Changing these two values alone is not sufficient to complete a deployment.

### 4.7 One-minute oral review

The `config.js` file is responsible for storing HOMEBOUND's Supabase connection settings. It contains the project URL, which identifies the database project, and a publishable API key intended for browser use. These settings are stored in a global object so the database service can access them. This file separates configuration from application logic, making the system easier to maintain and configure for another deployment. For security, the application must rely on authentication and properly configured Row Level Security policies instead of treating the publishable key as a password. Privileged secret keys must never appear in frontend code. The configuration itself does not perform database operations.

### 4.8 Quick memorization guide

| Term | Remember it as |
|---|---|
| `config.js` | Connection settings |
| Project URL | Where to connect |
| Publishable key | Public application API key |
| `window` | Shared browser access |
| RLS | Database row access rules |
| Authentication | Who is the user? |
| Authorization | What may the user do? |
| Demo mode | Sample data instead of live database records |

**Review scope:** Based on the submitted configuration and previously supplied HTML/application code. No network connection, credentials, database policies, or runtime behavior were tested.

---

<a id="part-5"></a>

## Part 5 — `js/supabase-service.js`: Backend communication

> Source: submitted 252-line JavaScript file. This reviewer explains the code by feature rather than requiring line-by-line memorization.

### 5.1 Main purpose

This file is the bridge between HOMEBOUND's main application (`app.js`) and Supabase. It provides a reusable object called `HomeboundStore` that handles authentication, property records, photo uploads, visitation requests, messaging, tenancy management, rent records and database change notifications.

```text
index.html → app.js → HomeboundStore → Supabase
                         ↑              ├── Authentication
                     config.js          ├── PostgreSQL database / RPCs
                                        ├── Storage
                                        └── Realtime
```

Remember: `config.js` provides connection settings; `supabase-service.js` communicates with the backend; `app.js` handles the interface and application workflow.

### 5.2 Code map

| Lines | Section | Main responsibility |
|---|---|---|
| 1–23 | Configuration and client | Initialize Supabase when needed |
| 24–55 | Data conversion | Convert database rows to application objects and back |
| 56–82 | Listing retrieval and authentication | Read listings; check, sign in and sign out landlords |
| 84–105 | Listing management | Create, update and delete listings |
| 106–150 | Image storage | Validate and upload images; return public URL |
| 152–174 | RPC and hold requests | Submit, retrieve, cancel and update holds |
| 175–200 | Messaging | Student messages, owner inbox and replies |
| 201–230 | Tenancies and payments | Assign beds, end tenancies and track dues |
| 232–245 | Realtime | Subscribe to and remove database change listeners |
| 247–252 | Public API | Expose methods through `HomeboundStore` |

### 5.3 Configuration and initialization

```js
const configured = Boolean(url && key);
let client = null, liveChannel = null;
```

`configured` is true when both settings are nonempty; it does not prove the credentials are valid or the network is working. `getClient()` creates the SDK client only when first needed and reuses it afterward. It throws an error if configuration or the SDK is missing.

The outer `(() => { ... })()` is an immediately invoked function expression (IIFE). It runs immediately and keeps internal variables and helper functions private within its closure, while the returned object exposes selected methods. This is organization, not a security boundary against browser users.

#### Why login is required after a refresh

```js
client = window.supabase.createClient(url, key, {
    auth: { persistSession: false }
});
```

The client does not persist the authentication session across page reloads. A landlord must sign in again after refreshing. Saved database records and uploaded photos are separate from the login session and are not deleted by refreshing.

### 5.4 Data conversion

The frontend and database use different property names. These helpers translate between them.

| Database (snake_case) | Frontend (camelCase) |
|---|---|
| `owner_id` | `ownerId` |
| `location_zone` | `locationZone` |
| `min_price` | `minPrice` |
| `max_price` | `maxPrice` |
| `main_image` | `mainImage` |
| `owner_name` | `ownerName` |

- `rowToDorm(row)` converts a database row into the format used by `app.js`, normalizes numbers, handles missing coordinates and ensures room images, amenities and beds are arrays.
- `dormToRow(dorm)` prepares editable listing fields for insertion or updating. It does not send an owner ID; the database must supply and enforce ownership.

The rooms array contains room details and nested individual bed records. This file does not show how the database validates that structure.

### 5.5 Authentication and authorization

| Function | Purpose |
|---|---|
| `currentOwner()` | Gets the authenticated user and checks for their ID in `landlords` |
| `login(email, password)` | Signs in with Supabase Auth and rejects accounts not approved as landlords |
| `logout()` | Signs out the authenticated user |

Workflow: email/password → Supabase Auth → check `landlords` table → return approved owner details or sign out and throw an error.

Authentication answers **who are you?** Authorization answers **what are you allowed to do?** The approval check is an application-level check. Actual database protection depends on RLS policies and RPC permissions, which must be inspected in `schema.sql`.

### 5.6 Property listing CRUD

CRUD means Create, Read, Update and Delete.

| Function | Supabase operation | Explanation |
|---|---|---|
| `list()` | `.select('*')` | Read listings, newest updated first |
| `create(dorm)` | `.insert(...)` | Check approved owner and insert listing |
| `update(dorm)` | `.update(...)` | Update matching listing ID and owner ID |
| `remove(id)` | `.delete()` | Delete matching listing ID and owner ID |

Example from the update flow:

```js
.from('listings').update(dormToRow(dorm))
.eq('id', dorm.id).eq('owner_id', owner.id)
.select('*').single();
```

`.eq()` applies filters; `.single()` expects one returned row. The owner filter reduces accidental cross-owner updates, but does not replace server-side policies. `list()` relies on database access policies to determine which rows are visible.

### 5.7 Image uploads — Supabase Storage

`uploadImage(file)` uploads the actual binary file, not just its filename.

1. Check whether the landlord is approved and signed in.
2. Require a browser `File` object.
3. Accept JPEG, PNG and WEBP MIME types only.
4. Reject empty files and files larger than 5 × 1024 × 1024 bytes (5 MiB, labeled 5 MB in the interface).
5. Generate a unique storage path: `owner-id/random-id.extension`.
6. Upload to the `listing-images` bucket with `upsert: false`.
7. Obtain and return an HTTPS public URL.

`upsert: false` means an existing object with the same path is not overwritten. The unique filename avoids relying on the original filename. The returned URL can be saved as part of the listing data by the application.

| Error | Meaning |
|---|---|
| Empty image | File size is zero; rejected before upload |
| Failed to fetch | Network or blocked storage request may be involved |
| 401/403 | Authentication or permission issue may be involved |
| 404 / bucket not found | Check that the storage bucket exists |
| 413 | Upload exceeds the storage size limit |

**Important:** This file does not implement drag-and-drop events; those belong to the interface/application logic. Generating a public URL does not prove that the image is publicly accessible. Actual access depends on bucket settings and policies. This uploader does not itself delete previously saved image links, but listing updates may replace URLs depending on how `app.js` constructs the listing.

### 5.8 RPC — Remote Procedure Call

```js
async function callRpc(name, params) {
    const { data, error } = await getClient().rpc(name, params);
    if (error) throw error;
    return data;
}
```

RPC allows the browser to call a PostgreSQL function by name and pass parameters. The helper centralizes error handling. It does not itself implement the database function or guarantee atomicity, authorization or validation. Those rules are defined on the server.

### 5.9 Visitation and hold requests

| Service function | Database function / operation |
|---|---|
| `createHold(payload)` | `homebound_create_hold_with_chat` |
| `getHold(id, token)` | `homebound_get_hold` |
| `cancelHold(id, token)` | `homebound_cancel_hold` |
| `setHoldStatus(id, status)` | `homebound_owner_set_hold_status` |
| `listHolds()` | Read `hold_requests` |

The create operation sends the listing ID, room name, student name, phone, email, visit date/time, request token, chat token and optional conversation ID. Tokens are passed to the server for student access to their requests; server-side validation must be verified separately.

`listHolds()` displays pending requests as `Expired` when their expiration timestamp is already past. This conversion occurs in the returned JavaScript data; it does not directly update the database row.

Remember: a hold request is not a confirmed tenancy or guaranteed reservation. The exact expiration and approval rules depend on SQL.

### 5.10 Student-owner messaging

| Function | Purpose |
|---|---|
| `studentSend()` | Calls `homebound_student_send` with listing, conversation, token and message |
| `studentMessages()` | Calls `homebound_student_messages` with conversation ID and token |
| `listConversations()` | Reads conversations and associated listing titles, newest activity first |
| `ownerMessages()` | Reads up to 200 messages for a conversation, oldest first |
| `ownerReply()` | Inserts a message with sender `owner` |

Student operations use RPCs; owner operations here use table queries or inserts. The backend must verify conversation access and sender permissions. The service does not create message bubbles or unread badges; `app.js` handles presentation.

### 5.11 Bedspace and tenancy management

| Function | RPC or table |
|---|---|
| `listTenancies()` | `tenancies` table |
| `assignTenant(payload)` | `homebound_assign_bed` |
| `setBedAvailable(...)` | `homebound_set_bed_available` |
| `endTenancy(id)` | `homebound_end_tenancy` |

`assignTenant()` sends the listing ID, room name, individual bed slot, tenant contact details, start date, due day, monthly rent and optional hold ID. This supports assignment to a specific bed rather than only an entire room.

The actual rules for preventing double booking, occupying a bed, freeing a bed and retaining ended tenancy history belong to the SQL functions. This adapter invokes those functions but does not demonstrate their internal behavior.

### 5.12 Rent tracking

| Function | Purpose |
|---|---|
| `syncRentPayments()` | Calls `homebound_sync_payments` to request schedule synchronization |
| `listRentPayments()` | Reads `rent_payments`, ordered by due date descending |
| `setRentPaid(id, paid)` | Calls `homebound_mark_payment` with payment ID and paid flag |

The service still uses separate `tenancies` and `rent_payments` tables. The interface may consolidate their display, but this does not mean the tables are physically merged. This file tracks rent records, not online payment transfers or SMS delivery.

### 5.13 Realtime database changes

`subscribe(onChange)` creates one channel called `homebound-changes` and registers listeners for all PostgreSQL change events (`event: '*'`).

| Table | Callback value |
|---|---|
| `listings` | `listings` |
| `chat_messages` | `messages` |
| `hold_requests` | `holds` |
| `tenancies` | `tenancies` |
| `rent_payments` | `payments` |

When a permitted change arrives, the callback tells the application what kind of data changed. The application decides what to reload. `unsubscribe()` removes the channel and clears its reference. Realtime requires correct backend publication, permissions and a working connection; subscribing alone does not guarantee delivery.

### 5.14 Important JavaScript terminology

| Term | Easy meaning |
|---|---|
| SDK | Library used to communicate with Supabase |
| API | Interface for requesting backend operations |
| `async` / `await` | Handle asynchronous operations without blocking the whole page |
| Destructuring | Extract values, e.g. `const { data, error } = ...` |
| `throw` | Report a failure to the calling code |
| `try/catch` | Handle errors from operations |
| `?.` | Safely access a possibly missing property |
| `??` | Use a fallback only for null or undefined |
| RLS | Database rules controlling access to individual rows |
| RPC | Call a database function remotely |
| Realtime | Receive permitted database change notifications |
| Closure | Functions retain access to variables from their enclosing scope |

### 5.15 Possible defense questions and answers

**1. Why separate the Supabase service from `app.js`?**  
It centralizes backend communication, allowing interface code to focus on user interactions and reducing repeated database code.

**2. How does HOMEBOUND connect to Supabase?**  
The service reads the URL and publishable key from `HOMEBOUND_CONFIG` and creates an SDK client through `getClient()`.

**3. Why does refreshing require a new landlord login?**  
`persistSession: false` prevents the SDK from persisting the session across reloads. Database records are not erased.

**4. Can any authenticated user become a landlord?**  
The application checks whether the authenticated user's ID exists in `landlords`. Backend policies must also enforce this restriction.

**5. What is the difference between database and Storage?**  
The database stores structured records and image URL references; Storage holds actual image files.

**6. Why use random filenames?**  
They reduce collisions and avoid trusting user-controlled filenames as storage paths. Uploads do not overwrite matching objects.

**7. What is the purpose of RPC?**  
It allows the frontend to invoke server-side database functions for operations such as bed assignment and hold submission. The SQL implementation determines the actual rules.

**8. How are student conversations accessed without a landlord login?**  
The student service methods pass conversation IDs and tokens to dedicated RPCs. The backend must validate those tokens.

**9. How do listing changes reach the application?**  
Realtime listeners notify the app of changes, and the app can reload relevant data. Delivery depends on configuration and access permissions.

**10. Does the service guarantee that two students cannot rent the same bed?**  
Not by itself. It calls `homebound_assign_bed`; prevention of double assignment must be verified in the SQL function and database constraints.

**11. What happens if an operation fails?**  
Most methods throw Supabase errors for the calling application to handle. Image upload additionally translates several common failures into clearer messages.

**12. Does this file send SMS or collect rent?**  
No. It synchronizes and updates rent payment records; it contains no SMS gateway or payment-processing integration.

### 5.16 One-minute oral review

The Supabase service is HOMEBOUND's backend communication layer. It initializes the Supabase client using the settings in config.js and provides reusable methods through HomeboundStore. It authenticates landlords and checks whether they are approved, retrieves and manages property listings, uploads image files to Storage, and uses database RPCs for hold requests, student messages, bed assignments and rent tracking. It also listens for database changes so the application can refresh relevant information. Authentication sessions are not persisted across page reloads, but saved database records remain. The service separates backend communication from the user interface, while actual authorization, data integrity and transaction rules must be enforced by the database.

### 5.17 Quick memorization guide

| Remember | Function or concept |
|---|---|
| Connect | `getClient()` |
| Translate | `rowToDorm()` / `dormToRow()` |
| Verify landlord | `currentOwner()` / `login()` |
| Manage properties | `list()`, `create()`, `update()`, `remove()` |
| Upload photo | `uploadImage()` |
| Request a visit | `createHold()` |
| Communicate | `studentSend()` / `ownerReply()` |
| Assign a bed | `assignTenant()` |
| End rental | `endTenancy()` |
| Track rent | `syncRentPayments()` / `setRentPaid()` |
| Listen for changes | `subscribe()` |

**Review scope:** Static inspection of the submitted service code only. No original code was changed, no live Supabase connection was attempted, and SQL policies, RPC internals, storage configuration and runtime behavior have not been verified. Review `schema.sql` next to understand the actual server-side rules.

---

<a id="part-6"></a>

## Part 6 — `js/app.js`: Application logic and user interactions

> **Study goal:** Understand the main application logic without memorizing approximately 2,367 lines of JavaScript. Line references refer to the submitted version.

### 6.1 What is this file for?

`app.js` is the main controller of HOMEBOUND. It connects the HTML interface to application data and responds to user actions. It handles searching, maps, landlord authentication, holds, conversations, individual beds, tenancy records, rent tracking, image uploads and analytics.

- HTML provides the elements; CSS controls their appearance; JavaScript controls their behavior.
- `HomeboundStore` is the interface to the database service. This file calls it rather than implementing the database itself.
- Leaflet renders maps; Chart.js renders charts; `sampleDormsData` and other demo records support local preview.
- Live mode uses Supabase through `HomeboundStore`; demo mode primarily uses browser memory and selected local storage records. Demo data is not a durable shared database.

### 6.2 Quick navigation map

| Approximate lines | Section | Main responsibility |
|---|---|---|
| 1–129 | State and helpers | Store current data, sanitize output, calculate bed availability, load listings |
| 130–258 | Initialization and maps | Start application, subscribe to updates, place property pins |
| 259–345 | Portal and authentication | Switch student/owner views, sign in and out |
| 346–501 | Student search and preview | Filter properties, display cards, rooms and photos |
| 502–637 | Hold workflow | Validate and submit visits, select and cancel holds |
| 638–814 | Chat and assistant | Owner inquiry chat and rule-based recommendations |
| 815–1219 | Tenancies and rent | Assign beds, generate demo dues, preserve ended tenancy records |
| 1220–1463 | Owner management | Tabs, requests, payment status, expandable listings, availability |
| 1464–1708 | Listing editor | Create/edit/delete properties, room details and bed slots |
| 1709–1860 | Reports and hold helpers | Print, local hold history, status polling, owner data |
| 1861–2085 | Amenities and images | File validation, drag-and-drop recovery, previews and upload |
| 2086–2242 | Messaging synchronization | Student inbox, unread counts, owner replies, assistant context |
| 2243–2340 | Dashboard and analytics | KPIs, charts and recommendations |
| 2341–2367 | UI utilities | Close modals and display toast notifications |

### 6.3 Important state variables

State means information the application keeps while it runs.

| Variable | Meaning |
|---|---|
| `currentPortal` | Current interface, initially `student` |
| `dormsData` | Property listings and nested rooms/bed slots |
| `activeDormViewing`, `selectedRoomIndex` | Property and room currently being inspected |
| `studentHolds`, `activeUserHold` | Multiple requests and the currently selected request |
| `hiddenHoldStatuses` | Tracks dismissed status notifications |
| `activeOwner`, `demoOwnerAuthenticated` | Live owner identity or demo authentication flag |
| `editingListingId`, `expandedOwnerListingId` | Listing being edited or expanded |
| `studentChatToken`, `studentConversationId` | Student conversation access and identity |
| `ownerConversations`, `ownerHolds` | Owner-side loaded conversations and requests |
| `tenantRecords`, `rentRecords` | Tenancy and monthly payment records |
| `listingDraftCoordinates` | Latitude and longitude selected in listing editor |
| `reportCharts` | Chart instances to destroy before redrawing |

**Data hierarchy:** Property → rooms → individual bed slots. A tenancy identifies a property, room and bed; payment records refer to a tenancy ID.

### 6.4 Initialization and live updates

`window.onload` starts the application: initializes the map, renders the interface, restores holds, starts polling, updates statistics and checks whether the database is configured. In live mode it clears sample listings before loading database listings, retrieves the current owner and registers change subscriptions.

`loadListings()` calls `HomeboundStore.list()`, normalizes bed counts and refreshes the views. `refreshListingViews()` updates student filters, owner listings and an open room preview.

| Update mechanism | Timing / trigger |
|---|---|
| Hold status polling | Every 15 seconds and window focus |
| Student inbox polling | Every 12 seconds and window focus |
| Open live chat polling | Every 7 seconds while open in live mode |
| Store subscription | Listing, message, hold, tenancy or payment changes |

Polling means periodically requesting updated data. It is not the same as an instant server push. Backend subscription permissions and delivery depend on the service implementation.

### 6.5 Student search, map and room preview

- `applyFilters()` reads the location and monthly budget. It splits the location into lowercase words and requires all words to appear in the property's address, landmark or title. Price filtering tests whether the property's price range overlaps the selected budget.
- `renderListingsGrid()` generates property cards and the result count. `resetFilters()` restores an empty search and any budget.
- `initLeafletMap()` centers the map on Baguio City (16.4023, 120.5960), using OpenStreetMap tiles. `updateMapMarkers()` removes old markers and plots the filtered properties with valid coordinates. Clicking a marker opens its listing.
- `openBedspaceViewer()` sets the selected property and first room. `renderRoomDetails()` shows photos, rate, amenities, available beds and notes. `selectRoomIndex()` and `switchRoomImageByIndex()` change the room or photo.
- `setListingPin()` and `clearListingPin()` manage the owner's draft coordinates. A draggable pin allows adjustments; the coordinates are included when saving.

**Limitation:** A matching price range does not guarantee a vacant room at that price. The regular search does not explicitly remove full properties.

### 6.6 Owner authentication

`attemptOwnerLogin()` displays the appropriate login form; `verifyOwnerPasscode()` checks demo credentials or calls `HomeboundStore.login(email, pass)`. `switchPortal()` prevents entering the owner view without the relevant authentication flag or owner identity. `logoutOwner()` signs out and returns to the student portal.

The demo passcode is hardcoded and is not production security. Real authorization must be enforced by the backend. On startup `currentOwner()` is called, so whether refreshing requires another login depends on the service's session settings; this file alone does not guarantee it.

### 6.7 Hold and visitation workflow

**Flow:** Inspect room → open form → validate → submit request → pending approval → owner reviews → student sees updated status.

| Function | Purpose |
|---|---|
| `openPreHoldForm()` | Rejects unavailable rooms and sets a minimum date of today |
| `normalizeVisitTimeInput()` | Converts `930`, `0930` or `9:30` into `09:30` |
| `submitHoldRequest()` | Checks student details, date and visiting hours; creates request and chat identifiers; saves via store or demo |
| `updateVisitStatus()` | Owner reviews pending request; demo also adds system chat update |
| `refreshActiveHold()` | Checks up to 30 pending or confirmed holds per poll using ID and token |
| `revokeActiveHold()` | Cancels a selected pending or confirmed request |
| `saveStudentHolds()` / `restoreActiveHold()` | Store and recover browser-side hold history |
| `dismissHoldBanner()` | Dismisses seen status notifications rather than deleting requests |

Visiting hours are 08:00–20:00. Each request has its own token and initial `Pending Approval` status. Multiple requests are maintained in an array. The 24-hour hold is a request, not a guaranteed rental or automatic tenancy. Actual expiry enforcement must be verified in the backend.

### 6.8 Messaging and assistant

`openChatFromModal()` keeps the room preview open and adds `chat-side-open`, which connects to the CSS layout. `openLiveChat()` restores conversation identifiers from local storage; `sendLiveChatMessage()` submits a message through `studentSend()` or demo data. `sendOwnerReply()` sends the owner's reply and refreshes the views. `pollStudentInbox()` checks non-student messages and compares their IDs with previously seen IDs to compute unread counts. `refreshStudentChat()` and `loadOwnerInbox()` retrieve and render conversations.

**Human chat vs. AI assistant:** Human chat communicates with the property owner. `processAIResponse()` implements local, rule-based assistance: it searches for keywords, detects budget numbers and location terms, checks data, and returns suggestions. Student suggestions include up to three properties sorted by minimum price; owner suggestions concern pending holds, messages, rates and availability.

There is no external generative AI API call in this function. It is more accurate to describe this as a context-aware, rule-based recommendation assistant. Location matching can fall back to other results, and availability, amenities and price need not match the same room.

### 6.9 Individual beds and listing management

`displayBedSlots()` returns existing beds or derives slots from room capacity/status. Capacity is bounded to 1–100 in its fallback and listing editor validation. `syncBedCountStatus()` counts available slots and updates the room's status.

```js
const free = beds.filter(b => b.status === 'Available').length;
room.status = free
    ? `Available (${free} ${free===1?'bed':'beds'} left)`
    : 'Full / Occupied';
```

Example: four beds with one occupied → three available. The count comes from individual statuses, rather than a manually entered availability total.

`renderAdminListings()` displays owner inventory; `toggleOwnerListingDetails()` expands one property at a time. `toggleBedAvailability()` changes individual availability; `toggleDormAvailability()` handles property-level availability. Occupied rental beds receive protection in the UI logic. `regenerateRoomBedSlots()` manages capacity changes; the listing editor reconciles changes to occupied slots. Backend enforcement must be checked separately.

#### CRUD (Create, Read, Update, Delete)

| Operation | Function |
|---|---|
| Create | `openNewListingModal()` → `saveListing()` → `HomeboundStore.create()` |
| Read | `loadListings()` → `HomeboundStore.list()` |
| Update | `openEditListingModal()` → `saveListing()` → `HomeboundStore.update()` |
| Delete | `deleteListing()` |

`saveListing()` validates required fields, unique room names, whole-peso prices and bed capacity, collects photos, calculates minimum/maximum prices and saves the property payload. Demo mode modifies local application data instead.

### 6.10 Tenant assignment and rent tracking

**Flow:** Owner confirms rental → select property, room and available bed → enter tenant details → save tenancy → update bed status → load monthly dues.

`openTenantAssignmentModal()` can prefill student details from a confirmed hold, locking the related property and room. `updateTenantRoomChoices()` and `updateTenantRoomRate()` show available rooms/beds and prefill rent. `submitTenantAssignment()` validates the selection, contact number, due day and agreed rent. Live mode calls `HomeboundStore.assignTenant()`; demo mode creates an active record, marks the bed occupied and generates rent records.

The comment describes an atomic backend RPC to prevent overbooking. An RPC is a remote procedure call; atomic means the related changes succeed or fail together. The actual transaction and constraints are not present in this file and require backend review.

`makeDueDate()` caps the due day at the last day of a month (e.g., day 31 becomes February 28 in a non-leap year). `syncDemoRentPayments()` generates monthly records from the start date, with a bounded lookback and next-month coverage; it prevents duplicate tenancy/date combinations. Live mode calls `syncRentPayments()` through the store.

```js
function assignedRentStatus(record) {
    return record.paid_at ? 'Paid' :
        String(record.due_date) < currentPhilippineDate()
            ? 'Overdue' : 'Pending';
}
```

A due today is pending unless marked paid. The date comparison uses Asia/Manila. `renderRentTracker()` groups installments by tenancy and prioritizes the oldest overdue due, then the next pending due, then a paid installment. It supports expanded history and status filters.

`togglePaymentStatus()` marks or undoes paid status after owner confirmation. `previewRentReminder()` calls `sendSMSPaymentReminder()`, which only displays a toast with sample SMS text. It does not send SMS or collect money.

#### Ending a tenancy

`endTenantAssignment()` asks for confirmation. Live mode calls `HomeboundStore.endTenancy()` and reloads records. Demo mode sets `Ended`, records the end date, reopens the bed, and removes unpaid future dues while retaining paid records and dues through the end date. The UI retains dates, duration, bed assignment, contact details and payment history. Ending is not the same as deleting a tenant record.

### 6.11 Image uploads and drag-and-drop

| Function | Role |
|---|---|
| `normalizeImageFile()` | Validates file type, size and nonzero bytes; infers missing MIME type from extension |
| `handleImageDrop()` | Captures drag data while the event is active and tries browser file-handle/entry recovery for empty files |
| `handleImageSelection()` | Handles Choose File input |
| `setDroppedImages()` | Stages images, avoids certain duplicates, enforces one main image and up to five room images |
| `renderZoneImages()` | Updates previews |
| `collectZoneImages()` | Retains existing URLs and uploads staged files on save (or converts to data URLs in demo) |
| `safeImageUrl()` / `onImageLoadError()` | Restricts URL forms and provides fallback image |

Accepted formats: JPG, PNG and WEBP, maximum 5 MB each. A zero-byte file contains no image data. Browser/cloud preview drags may provide empty placeholders; downloading the actual image or choosing a local file may help. The recovery logic is not a guarantee of browser compatibility.

Existing image URLs are preserved in the collection unless removed or replaced; selecting a new main photo intentionally clears the old main image in that zone. Upload errors are collected and the owner is asked whether to save without failed photos. Actual Storage permissions and upload success depend on the service/backend.

### 6.12 Dashboard and analytics

`refreshDashboardStats()` shows available beds versus total beds and contracted monthly rent (sum of active tenants' agreed rent, not collected cash).

`renderAnalytics()` calculates:
- Listed properties, available rooms, student conversations and pending visits.
- Active renters, ended tenancies, average completed stay, overdue rent.
- Six months of conversation counts, room counts by accommodation type, advertised price bands and request outcomes.
- Property-level room counts, availability, inquiries and holds.
- Rule-based recommendations about vacancies, rent, pending requests, inquiries and tenancy turnover.

Chart.js draws bar and doughnut charts; old chart instances are destroyed before creating replacements. `printAnalyticsReport()` invokes printing; CSS controls the print layout.

**Important distinction:** The room-share chart counts all rooms by property type, despite the HTML title referring to availability. Inquiry dates use `created_at` or fall back to `updatedAt`, and the hold outcome chart excludes `Rented`. These are limitations to consider when interpreting the report. This is descriptive and rule-based prescriptive analytics, not a trained forecasting model.

### 6.13 JavaScript concepts to understand

| Concept | Example / purpose |
|---|---|
| DOM | `document.getElementById()` accesses HTML elements |
| Event handling | `onclick`, `onsubmit`, `window.onload` respond to actions |
| Array `filter()` | Select available beds or matching properties |
| Array `map()` | Transform records into HTML or chart data |
| Array `reduce()` | Sum rent and availability counts |
| `async` / `await` | Wait for database or image operations without blocking normal asynchronous UI work |
| `try/catch/finally` | Handle failures and restore disabled buttons |
| `localStorage` | Store browser-local hold and chat metadata across reloads |
| `crypto.randomUUID()` | Generate request, conversation and demo record identifiers |
| `escHtml()` | Escape special characters before rendering text as HTML; helps mitigate injection |
| `setInterval()` | Repeat updates periodically |
| Optional chaining `?.` | Access values that may be missing without throwing at that access |

### 6.14 Possible project defense questions

**Q1: What is the main purpose of app.js?**  
It coordinates UI events, application state, data operations and feature workflows.

**Q2: How is availability updated?**  
Each bed has its own status. The application counts available beds, derives room status and refreshes relevant views after changes.

**Q3: How do you prevent double bookings?**  
The frontend checks the selected slot, and the live assignment is delegated to a backend operation described as atomic. Actual concurrency protection needs verification in the SQL/service code.

**Q4: Does submitting a hold make the student a tenant?**  
No. Only a separate owner-confirmed assignment creates a tenancy.

**Q5: How do students receive owner updates?**  
The browser polls token-scoped conversations and hold statuses, and the app also registers store subscriptions where applicable.

**Q6: Is the chatbot generative AI?**  
Not in this file. It uses keyword matching and rule-based recommendations from current application data.

**Q7: How does the application handle ended tenancies?**  
It labels them ended, retains historical information and reopens the assigned bed; live changes are delegated to the store.

**Q8: Does the system process rental payments or send SMS?**  
No. It tracks dues and landlord-recorded payment status, and previews reminder text.

**Q9: Why use Supabase and a service abstraction?**  
The app calls `HomeboundStore` for shared data operations instead of placing all database implementation details in the UI controller. The exact service architecture is reviewed separately.

**Q10: How does image upload work?**  
The app validates and stages files, displays previews, then uploads on listing save. Existing images and upload errors are handled separately.

**Q11: How are recommendations generated?**  
The app calculates metrics from available records and applies predefined conditions to produce management suggestions.

**Q12: Is hiding the owner portal enough for security?**  
No. Frontend checks improve the interface but database permissions and backend validation must also enforce access.

### 6.15 One-minute oral review

The app.js file serves as HOMEBOUND's main application controller. It connects the HTML interface to the property records and handles student searches, map pins, room previews, visitation requests and communication. For landlords, it manages property listings, individual bed availability, tenant assignments and monthly rent records. The application uses Supabase through HomeboundStore in live mode and sample data in demo mode. It refreshes information through polling and registered subscriptions. The analytics module summarizes records and provides rule-based recommendations, while the assistant matches student preferences and suggests owner actions. Payment tracking records payment status rather than transferring money, and SMS reminders are previews only. Historical tenancy information is retained for future review.

### 6.16 Quick memorization guide

Remember seven verbs: **Load → Search → Request → Communicate → Assign → Track → Analyze.**

Focus on `loadListings`, `applyFilters`, `submitHoldRequest`, `sendLiveChatMessage`, `submitTenantAssignment`, `syncBedCountStatus`, `saveListing`, `endTenantAssignment` and `renderAnalytics` first. You do not need to memorize the HTML templates inside these functions.

---
**Review scope:** Static review of the submitted application code only. No original code was changed or executed. The database service, configuration and SQL schema have not been reviewed here, so backend security, persistence, expiry, upload and concurrency behavior are not independently verified.

---

<a id="part-7"></a>

## Part 7 — `schema.sql`: Database architecture and business rules

> Study goal: understand the database and its business rules without memorizing 915 lines of SQL. Line references refer to the submitted script. This is a static review, not a database test or an instruction to execute the migration.

### 7.1 What is this file?

`schema.sql` defines the PostgreSQL backend used by Supabase. It creates tables, relationships, validation rules, access policies, database functions, storage settings, and Realtime publications. While `app.js` controls the interface and `supabase-service.js` communicates with Supabase, this file determines what operations the database permits.

```text
Student / Landlord → HTML + app.js → HomeboundStore
                                      ↓
                         Supabase API / RPC
                                      ↓
                  PostgreSQL tables, RLS and functions
                                      ↓
                         Response / Realtime event
```

### 7.2 Quick map of the source

| Lines | Topic |
|---|---|
| 1–73 | Transaction, landlord and listing tables, timestamps, RLS |
| 75–164 | Hold requests and their original functions |
| 166–274 | Conversations, messages, tokens and permissions |
| 276–309 | Photo storage, Realtime, manual landlord approval |
| 311–372 | Tenancies, rent payments and access rules |
| 378–508 | Original room-level assignment and ending logic |
| 510–572 | Monthly due generation, marking paid, Realtime |
| 574–657 | Migration to individual bed slots |
| 659–837 | Bed status helper, validation trigger, assignment and termination |
| 839–915 | Hold-chat linkage, automatic status messages, final permissions and commit |

### 7.3 Database tables (seven public tables)

| Table | Purpose | Important columns |
|---|---|---|
| `landlords` | Approved owner accounts | `user_id`, `display_name`, `approved_at` |
| `listings` | Published properties | `id`, `owner_id`, `title`, `location_zone`, `min_price`, `max_price`, `lat`, `lng`, `main_image`, `rooms` |
| `hold_requests` | Student visits and hold requests | `listing_id`, `owner_id`, `room_name`, student details, `request_token`, `status`, `expires_at`, `chat_conversation_id` |
| `chat_conversations` | A conversation about a listing | `listing_id`, `owner_id`, `student_token`, timestamps |
| `chat_messages` | Individual messages | `conversation_id`, `sender`, `body`, `created_at` |
| `tenancies` | Confirmed rental agreements | `listing_id`, `room_name`, `bed_slot`, tenant details, `monthly_rent`, `start_date`, `due_day`, `status`, `end_date`, `source_hold_id` |
| `rent_payments` | Monthly rent obligations | `tenancy_id`, `owner_id`, `due_date`, `amount_due`, `paid_at` |

`auth.users` and `storage.buckets` / `storage.objects` are Supabase-managed structures, not additional HOMEBOUND public tables created here.

### 7.4 Relationships and data organization

```text
auth.users ── 0..1 landlords (approval)
     │
     └── 1:N listings
                ├── 1:N hold_requests ── optional link to conversation
                ├── 1:N chat_conversations ── 1:N chat_messages
                └── 1:N tenancies ── 1:N rent_payments
                          └── optional unique source_hold_id
```

- A primary key uniquely identifies a record; a foreign key links records.
- One listing can have many rooms. Rooms and their beds are nested JSONB objects inside `listings.rooms`, not separate relational tables.
- `source_hold_id` is unique: a hold can be linked to at most one tenancy. Direct assignments do not require a hold.
- One tenancy can have many monthly payment records. The unique pair `(tenancy_id, due_date)` prevents duplicate monthly obligations.
- Deleting a listing is restricted while any tenancy references it, including ended tenancies. Holds and conversations have cascading listing foreign keys; deleting a conversation cascades to messages. These are not unconditional permanent archives.

### 7.5 SQL basics used in the file

| Term | Plain-English meaning |
|---|---|
| `BEGIN` / `COMMIT` | Group schema changes into a transaction |
| `CREATE TABLE IF NOT EXISTS` | Create a table only if missing |
| `ALTER TABLE` | Modify an existing table |
| `CREATE OR REPLACE FUNCTION` | Install or replace database logic |
| `UUID` | Unique identifier; generated for many records |
| `JSONB` | Structured JSON stored in PostgreSQL |
| `NOT NULL`, `CHECK`, `UNIQUE` | Require values, validate rules, prevent duplicates |
| `INDEX` | Helps relevant queries locate records efficiently |
| `TRIGGER` | Runs automatically when a specified database event occurs |
| `RPC` | Remote procedure call: browser requests a database function |
| `FOR UPDATE` | Locks selected rows until the transaction ends |
| `GRANT` / `REVOKE` | Give or remove database privileges |
| `SECURITY DEFINER` | Function runs with its owner's privileges; explicit authorization checks are essential |
| `SET search_path = ''` | Restricts name resolution; schema-qualified references help avoid unsafe lookup |

Example: `CHECK (monthly_rent > 0)` rejects nonpositive rent at database level, even if someone bypasses the HTML form.

### 7.6 Authentication and Row Level Security (RLS)

Authentication identifies a user through Supabase Auth. Authorization determines what that user can do. `auth.uid()` returns the authenticated user's ID. Being authenticated does not automatically make a user an approved landlord: an entry in `public.landlords` is also required.

| Resource | Anonymous student | Approved landlord |
|---|---|---|
| Listings | Read published rows | Read all; insert/update/delete own rows |
| Landlord approvals | No direct access granted here | Read own approval |
| Holds | Token-based RPCs | Read own requests; status changes through RPC |
| Conversations/messages | Token-based RPCs | Read own conversations; insert own replies |
| Tenancies and payments | No direct access | Read own records; writes through approved RPCs |
| Listing photos | Public viewing | Upload/delete objects in own UUID folder |

Simplified policy idea (lines 65–69):

```sql
using (owner_id = (select auth.uid())
  and exists (select 1 from public.landlords
              where user_id = (select auth.uid())))
```

`USING` checks existing rows; `WITH CHECK` checks rows being inserted or updated. RLS and table/function privileges work together. The script supports approved owners managing their own listings; it does not enforce a maximum of one landlord account. The one-owner deployment is a project decision.

### 7.7 Hold and visitation requests

Current frontend entry point: `HomeboundStore.createHold()` calls `homebound_create_hold_with_chat()` (853–876).

1. Validate or create a conversation using the student's chat token.
2. Call `homebound_create_hold()` (102–127), which checks visitation details and room availability.
3. Insert a request with `Pending Approval` and a default expiry 24 hours after creation.
4. Link the request to its conversation and return the request ID and conversation ID.
5. Approved owner calls `homebound_owner_set_hold_status()` (878–901). Only pending, unexpired, owner-owned requests can be approved or declined.
6. The database inserts a system message into the linked conversation after approval/decline.

| State | Meaning |
|---|---|
| Pending Approval | Awaiting owner response |
| Confirmed Visit | Owner approved the visit, not a rental contract |
| Declined | Owner rejected the visit |
| Cancelled by Student | Student cancelled using request ID and token |
| Expired | Computed when a pending request passes expiry; not a stored allowed status |
| Rented | A confirmed hold was linked to a completed tenant assignment |

A hold does **not** occupy or exclusively reserve a bed in this SQL. Multiple requests may target the same room. Actual occupancy is changed by tenant assignment. The SQL allows visitation dates up to 180 days ahead; the frontend's 08:00–20:00 visiting-hours rule is not enforced here.

### 7.8 Messaging

`homebound_student_send()` (217–239) creates a conversation or verifies an existing conversation's ID, listing and token before saving a student message. Message length is 1–2,000 characters. `homebound_student_messages()` (241–250) returns up to the latest 200 messages, presented chronologically. Owner replies are direct inserts checked by RLS. The final sender constraint permits `student`, `owner`, and `system`; owners' direct insert policy permits only `owner`.

The `chat_message_touch` trigger updates conversation `updated_at` after each message, helping sort recent conversations. A request token and a conversation token serve different purposes. They provide possession-based access, not verified student identity. Losing the browser-held token may prevent anonymous access recovery.

### 7.9 Individual bed availability (the current model)

Example of a room inside `listings.rooms` (illustrative subset):

```json
{
  "name": "Room 101",
  "totalCapacity": 3,
  "beds": [
    {"id": "bed-1", "status": "Occupied"},
    {"id": "bed-2", "status": "Available"},
    {"id": "bed-3", "status": "Unavailable"}
  ],
  "status": "Available (1 bed left)"
}
```

- `Available`: can be assigned; `Unavailable`: manually blocked; `Occupied`: linked to an active tenancy.
- `homebound_migrate_room_beds()` converts older room data to individual slots and uses active tenancy records to identify occupancy.
- `homebound_apply_bed_status()` changes one slot and recalculates the room availability label.
- `homebound_set_bed_available()` lets an approved owner block/unblock a vacant bed, but not an occupied bed.
- `homebound_protect_occupied_rooms()` is a trigger function validating declared capacity (1–100), required slot IDs, statuses, consistency with active tenants, and whether a room has any available slots. It also rejects removal/renaming of rooms with active tenancies.

Note: the room label `Full / Occupied` means zero available slots; some or all may be manually blocked rather than physically occupied.

### 7.10 Tenant assignment and overbooking prevention

Current RPC: `homebound_assign_bed()` (771–817).

```text
Approved landlord selects room + specific bed
  → Validate tenant name, phone, dates, rent and due day
  → Lock listing row (FOR UPDATE)
  → Verify listing ownership and bed availability
  → Check no active tenant already uses that bed
  → Validate linked confirmed hold, if supplied
  → Insert tenancy with exact bed_slot
  → Change that bed to Occupied and recalculate availability
  → Mark linked hold Rented, if supplied
  → Return tenancy UUID
```

The listing row lock serializes competing assignments; a partial unique index adds a second protection:

```sql
create unique index if not exists tenancies_one_active_bed
on public.tenancies(listing_id,room_name,bed_slot)
where status='Active' and bed_slot is not null;
```

This means two active tenancies cannot use the same listing, room and non-null bed slot. Ending a tenancy allows the same slot to be assigned again. The RPC performs related changes in one transaction; a raised error prevents a partially completed assignment. Monthly dues are generated separately by the sync RPC, not directly by the assignment function.

### 7.11 Ending a tenancy

Current function: `homebound_end_tenancy()` (820–837).

1. Verify approved landlord and ownership of the active tenancy.
2. Lock the listing row.
3. Set tenancy `status` to `Ended` and record Philippine-local end date.
4. Remove future unpaid dues dated after move-out; retain past dues and already-paid records.
5. Set only the previously assigned bed to `Available`.

The tenant's name, start/end dates, agreed rent and prior retained payment records remain available for historical review. This is a status change, not deleting the tenancy.

### 7.12 Automatic monthly rent tracking

`homebound_sync_payments()` (513–537) generates due records for the approved landlord's tenancies, starting from the later of the tenancy's start month and the month containing the date 24 months ago, through one upcoming month. It excludes dates before move-in and after recorded move-out.

Example: if the due day is 31, February uses its last valid day (28 or 29). A unique constraint plus `ON CONFLICT (tenancy_id,due_date) DO NOTHING` prevents duplicate obligations during repeated synchronization.

`homebound_mark_payment()` (539–550) sets `paid_at` to the current timestamp when marked paid, or to `NULL` when undone. The frontend derives Pending, Overdue and Paid labels. There is no payment gateway, bank verification, or SMS gateway. The schema defines a callable sync function, not a scheduled background job.

### 7.13 Photo storage and Realtime

**Storage (276–288):** The `listing-images` bucket is public for viewing. Uploads and deletions require an approved authenticated landlord and an object path whose first folder equals that user's UUID. Allowed MIME types are JPEG, PNG, WEBP; size limit is 5 MiB (5,242,880 bytes). The service uploads binaries and saves URLs in listing data. Public photo URLs are not private tenant data.

**Realtime (290–304, 562–572):** The script adds `listings`, `chat_messages`, `hold_requests`, `tenancies`, and `rent_payments` to the `supabase_realtime` publication when absent. This enables change notifications subject to access rules. JavaScript subscribes and refreshes views; anonymous private conversations are retrieved through token-based polling in the application. Publication alone does not make every private event publicly accessible.

### 7.14 Important functions to recognize

| Function (prefix `homebound_`) | Job | Lines |
|---|---|---|
| `set_updated_at` | Update listing timestamp automatically | 42–51 |
| `create_hold` | Validate and insert pending request | 102–127 |
| `get_hold` / `cancel_hold` | Token-based status / cancellation | 129–148 |
| `student_send` / `student_messages` | Token-based messaging | 217–250 |
| `sync_payments` / `mark_payment` | Generate dues / record payment status | 513–550 |
| `migrate_room_beds` | Upgrade old rooms to bed arrays | 604–657 |
| `apply_bed_status` | Change one bed and recalculate availability | 660–691 |
| `protect_occupied_rooms` | Validate listing room edits (latest version) | 694–739 |
| `set_bed_available` | Block/unblock vacant bed | 743–768 |
| `assign_bed` | Create actual rental and occupy bed | 771–817 |
| `end_tenancy` | End rental and release bed (latest) | 820–837 |
| `create_hold_with_chat` | Link a new request to a conversation | 853–876 |
| `owner_set_hold_status` | Approve/decline and create system message (latest) | 878–901 |

### 7.15 Migration and limitations worth knowing

- The script is intended to be re-runnable; it uses conditional creation, replacement functions, policy/trigger recreation, and conflict handling. This is not proof that every possible older database can migrate safely. Existing inconsistent data can cause validation errors and rollback. Back up and test migrations before production use.
- Later definitions replace earlier `protect_occupied_rooms`, `end_tenancy`, and `owner_set_hold_status` functions. Study the final versions. The older `create_tenancy` RPC is retained but execution is revoked from authenticated clients (913); the current service uses `assign_bed`.
- The final room validation trigger checks the presence of active tenants' room names and consistency for submitted slots, but does not explicitly check that every active tenant's slot still exists when capacity is reduced. Do not claim it proves all possible edits safe. A dedicated test for shrinking a room with an occupied high-numbered slot is warranted.
- Public listing SELECT allows all listing columns, including owner contact information. Student/tenant data are held in separate restricted tables. The script is not a complete security audit; deployed grants, function ownership, and any older policies should be verified.
- There is no separate admin table or distinct administrator dashboard permission model here beyond database administration and approved landlords. No AI model or analytics calculations are implemented in this SQL; those are frontend features using retrieved records.
- Tenancies and rent payments remain two separate tables, even though the dashboard presents them together. Historical records are retained on normal tenancy termination, not guaranteed against every administrative deletion.

### 7.16 Possible project defense questions and answers

**1. What is the purpose of schema.sql?** It defines database structure, access rules, and transactional business logic for HOMEBOUND.

**2. Why use Supabase?** In this implementation, Supabase provides PostgreSQL, Auth, Storage, an API for RPC, and Realtime notifications in one backend.

**3. How are students and landlords distinguished?** Students can read public listings and use token-based request/chat functions. Landlords sign in and must be present in the approved landlords table; RLS limits access to their own private data.

**4. What is RLS?** Row Level Security restricts which rows a database role can access or modify. It is enforced at the database, not just by hiding interface buttons.

**5. Why use RPC instead of direct updates for tenant assignments?** It centralizes ownership checks, bed availability checks, tenancy creation and availability updates in one database operation.

**6. How do you prevent two students renting the same bed?** The assignment RPC locks the listing row, checks the exact slot, and the partial unique index prohibits duplicate active assignments for a non-null bed slot.

**7. Does a 24-hour hold guarantee a bed?** No. It is a time-limited request for owner review. Only confirmed tenancy assignment changes the bed to Occupied.

**8. What happens when a tenancy ends?** It is marked Ended with a move-out date; its assigned bed is reopened; future unpaid dues after the end date are removed, while relevant historical records remain.

**9. How are monthly dues generated without duplicates?** The sync function creates dates by month, adjusts short months, and uses a unique tenancy/due-date constraint with conflict handling.

**10. Why store tenancies and payments separately?** One rental agreement can have many monthly dues. Separating them avoids repeating tenant information for each due and supports payment history.

**11. Why use JSONB for rooms?** It stores nested room, amenity, image and bed information within a listing. This is flexible, but requires explicit validation and more complex updates than separate room tables.

**12. How do students receive approval notifications?** The owner status RPC inserts a system message into the conversation linked to the hold; the frontend retrieves and displays it.

**13. Do you actually send SMS or collect money?** No. The system tracks rent and marks verified payments; SMS text is a frontend preview, not a gateway integration.

**14. Does the database store actual photos in the listings table?** No. Storage holds uploaded files; listing data contains image URLs.

**15. Does refreshing the browser delete records?** No. Saved records live in Supabase. The separate service file disables session persistence, requiring landlord login again on reload.

### 7.17 One-minute oral review

> Our schema.sql establishes HOMEBOUND's PostgreSQL backend in Supabase. It contains seven public tables for landlord approvals, property listings, visitation requests, conversations, messages, tenancies and rent payments. We use Row Level Security to restrict private records to approved owners, while students can browse listings and use token-based functions for requests and messaging. The database manages individual bed assignments through RPCs, row locking and a unique active-bed constraint to prevent conflicting rental assignments. When a tenancy ends, its assigned bed becomes available and historical tenancy records are retained. Monthly rent dues are generated through a synchronization function that prevents duplicate entries. Supabase Storage handles listing photos, and Realtime supports refreshing changed records. The system monitors rent; it does not process payments or send actual SMS messages.

### 7.18 Quick memorization guide

| Remember | Meaning |
|---|---|
| Schema | Database blueprint and rules |
| RLS | Who may access which rows |
| RPC | Execute checked database logic |
| Trigger | Automatically validate or update data |
| UUID | Unique record identity |
| JSONB | Nested room and bed details |
| Row lock + unique index | Prevent conflicting active bed assignments |
| Hold ≠ tenancy | Request is not an actual rental |
| Ended ≠ deleted | Keep rental history |
| Payment tracking ≠ payment processing | Record status, not transfer money |

**Study priority:** Tables → RLS → hold/chat workflow → assign/end bed → monthly dues → storage and Realtime. Focus on what enters each function, what it checks, and what it changes.

---
Source: submitted HOMEBOUND SQL script, 915 numbered lines. No original code modified; no migration executed or live database inspected. Examples and diagrams are explanatory simplifications.

---

## Final defense recap

HOMEBOUND uses HTML and CSS for the interface, Tailwind configuration for consistent design, JavaScript for user interactions and rule-based recommendations, and a Supabase adapter for authentication, database requests, storage and Realtime events. PostgreSQL tables, policies, constraints and RPC functions enforce the backend rules. A visitation request is not a confirmed rental; owner assignment occupies a specific bed, and ending the tenancy restores that bed while preserving historical records subject to the schema's retention rules. The rent tracker records payments rather than processing money, and SMS reminders are previews rather than actual messages.
