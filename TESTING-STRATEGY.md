# E2E Testing Strategy — Sales CRM Golden Demo

Goal: a full automated regression suite covering the key quote-to-cash
flows (see `FLOWS.md` — 24 scenes transcribed from the Sales CRM Demo
Clickpath, spanning SFA/CPQ/Order Management/Contracts/Subscription
Management, plus Sales Forecasting), so that a regression in the demo's
critical functionality is caught automatically rather than discovered live
during a demo.

**Instance strategy:** every flow was built and stabilized against
`opmsalescrm1` (Test/Staging) first — that's still where new specs should be
authored, since exploring/debugging against an unfamiliar instance is the
expensive part. Once a spec is stable there, run it against `opmsalescrmgd`
(Gold/Production) via `E2E_ENV_FILE=.env.opmsalescrmgd npx playwright test`
(a local, gitignored override — see `.env.opmsalescrmgd`) — this costs no
Claude time at all, it's plain Playwright. As of 2026-09-22, 17/20 of the
`opmsalescrm1`-verified specs passed unchanged against Gold on the first try
(2 failures were expected — the Forecasting spec's hardcoded sys_ids are
`opmsalescrm1`/`empksingampalli`-specific and don't exist on Gold's own
data; 1 was the genuine intermittent double-Contract finding below). Only
bring Claude back in to diagnose actual Gold-specific failures, not to
re-explore everything blind. Earlier work (the original Lead-to-Opportunity
spec, and the Sales Forecasting fixtures) was first built and verified
against a *third* instance, `empksingampalli`, before being re-verified on
`opmsalescrm1`.

This is a **design note**; the directory layout in §2 hasn't been built
yet. With 24 real flows now queued in `FLOWS.md`/`CATALOG.md` across 5+
domains, that restructure is clearly justified whenever specs actually start
getting written — this note doesn't trigger it by itself.

## 1. Test catalog — source of truth

`FLOWS.md` is the input backlog — plain-language flow descriptions, added by
whoever thinks of them, with as much detail (record numbers, expected
amounts, gotchas) as is known.

`CATALOG.md` is the derived, tracked output: one row per flow (Flow, Spec
file, Domain, Status, Last verified, Notes). It's regenerated/updated from
`FLOWS.md` whenever the backlog changes. This is what prevents duplicate
work across sessions/agents working on the same repo concurrently — check it
before starting a new flow's test. `Status` is one of: passing / flaky /
broken / not yet written.

## 2. Directory layout, once there's more than one domain

```
tests/
  sfa/                    # Scenes 1.1–1.2 — leads, opportunities
    lead-to-opportunity.spec.ts
    KNOWN-QUIRKS.md
  cpq/                     # Scenes 2.1–2.6 — quote, catalog, ramps, pricing, approvals, doc gen
    ...
  om/                      # Scenes 3.1–3.5 — order creation through fulfillment
    ...
  contracts/               # Scenes 4.1–4.3 — contract, contract lines, sold products
    ...
  subscription/            # Scenes 5.1–5.8 — amendment, renewal
    ...
  forecasting/
    rollup-aggregation.spec.ts
    KNOWN-QUIRKS.md
```

Domain folder names match the `Domain` column in `CATALOG.md` (`sfa`, `cpq`,
`om`, `contracts`, `subscription`, `forecasting`, `prm`).

One spec per flow. Group by domain folder so a `KNOWN-QUIRKS.md` can be
shared across specs that hit the same underlying UI (e.g. every Lead/Account/
Opportunity flow goes through the same CRM Workspace record view and hits the
same rendering quirks).

## 3. Known quirks discovered so far (CRM Workspace record view)

These came out of debugging `lead-to-opportunity.spec.ts` line by line — real,
reproduced issues, not theoretical:

- The **"Details" accordion section starts collapsed** on a fresh session/
  browser context. Always check `aria-expanded` and click to expand before
  looking for a field inside it.
- The field pane **virtualizes rows**: scrolling in one large jump skips
  mounting rows in between (a field can go from "not in DOM" to "already
  scrolled past" without ever rendering). Scroll in small increments (~150px)
  with a short pause between each step.
- Custom dropdown listboxes (the `now-select` component) render their option
  nodes inside a **popover that duplicates/overlaps itself** — a
  locator-driven `.click()` on an option flakes with "element not stable" or
  hits a stale copy. Workaround: locate the option, wait ~400ms for the open
  animation to settle, read its `boundingBox()`, and dispatch a real
  `page.mouse.click()` at its center — this ignores whatever else is stacked
  on top. Empirically `.last()` of the duplicate pair is the live one, not
  `.first()`.
- Selecting "Qualified" on a Lead's Stage field **auto-opens a "Convert lead"
  dialog** (no separate Save/click needed) that creates an Account, Contact,
  and Opportunity together. This is a real client-side behavior — driving it
  via the REST API directly (bypassing the UI) will NOT trigger it, since
  it's implemented as a client script reacting to the field change event.
  **On `opmsalescrm1` this path is a dead end**: the dialog opens but its
  content never renders (confirmed via screenshot after 45s+, reproduced
  repeatedly) — use the header's explicit **Convert Lead → to an account**
  split-button instead (see next point). Kept documenting this since it's
  still the mechanism on `empksingampalli`, where the original spec version
  passed.
- On `opmsalescrm1`, the header's **"Convert Lead" split-button** (with menu
  items "to an account" / "to a consumer") is the reliable trigger. It
  requires viewport width ≳1280px — below that it collapses into the "..."
  **More Actions overflow menu** instead (still present there, just nested
  one level deeper); the suite now forces a 1600×900 viewport in
  `playwright.config.ts` specifically to avoid that collapse.
- Even via the header button, the **"Convert lead" dialog's own content
  render time is unpredictable** on `opmsalescrm1` — usually ~3s, but
  reproducibly sometimes never populates at all (confirmed blank via
  screenshot well past 45s in isolation). Closing the dialog (`Close dialog`
  button) and re-triggering it reliably recovers. `lead-to-opportunity.spec.ts`
  retries the whole trigger sequence up to 3 times before failing for real.
  This dialog also **does not expose a `role="dialog"` container** matching
  Playwright's `getByRole('dialog')` — that scoping silently matches nothing
  and hangs for the full timeout no matter how long you give it. Assert on
  the heading (`getByRole('heading', {name: 'Convert lead'})`) directly
  instead, unscoped.
- Once the dialog is open, **two "Convert Lead"-named buttons exist**
  simultaneously (the header's split-button trigger + the dialog's own submit
  button) with the exact same accessible name. The dialog's copy is
  `.first()` in DOM order (apparently portaled earlier than the header), not
  `.last()` — `.last()` resolves to the header trigger, which is then
  unclickable (covered by the modal backdrop, "intercepts pointer events").
- The **"Convert lead" success dialog's links share a literal, buggy
  `aria-label="Accessible Label"`** — all three (Account/Contact/Opportunity)
  links have the same accessible name. Identify them by `href` pattern
  (`/customer_account/`, `/customer_contact/`, `/sn_opty_mgmt_core_opportunity/`)
  instead of by name. Confirmed present on both `empksingampalli` and
  `opmsalescrm1`.
- The Table API's default reference-field shape is `{display_value, link}`,
  not a plain string, unless `sysparm_exclude_reference_link=true` is passed.
- On an Account record, the header's **"Create Opportunity" button skips the
  intermediate form entirely** — it creates and saves the Opportunity
  immediately server-side and navigates straight to it (no fields to fill in,
  no Save click). Capture the new sys_id from the post-click URL
  (`.../sub/record/sn_opty_mgmt_core_opportunity/<sys_id>`) rather than
  waiting on any dialog.
- **Opportunity's "Owner" field is `assigned_to` in the backend**, not
  `owner` — `sys_dictionary` confirms `column_label=Owner` maps to
  `element=assigned_to` on `sn_opty_mgmt_core_opportunity`. The Table API
  silently omits unrecognized field names from `sysparm_fields` instead of
  erroring, so a wrong guess here reads back as `undefined`, not a 4xx.
- **Scene 1.2's Industry/Contact auto-population claims are reversed on
  `opmsalescrm1`** vs. the FLOWS.md description (written from a different
  instance's clickpath): here, Industry *does* auto-populate from the
  account's own Industry, and Contact does *not* — confirmed empty in both
  the header field and the Contacts related list, even with the account's
  `primary_contact` explicitly set beforehand. Territory and (the
  backend-named) `assigned_to` *do* auto-inherit from the account's
  `primary_sales_territory`/`sales_owner` with no manual assignment step —
  this is the actual mechanism behind "visible to territory-based ownership".
- The Quote table is **`sn_quote_mgmt_core_quote`**, not the more guessable
  `sn_qtms_quote` — confirmed via `sys_db_object` lookup
  (`nameLIKEquote^ORlabelLIKEQuote`) when a direct table-name guess 404'd.
- An Opportunity's header **"Create Quote" button does NOT navigate away**
  (unlike an Account's "Create Opportunity" button, which does) — it creates
  the Quote server-side and shows a toast ("Quote Created. View
  &lt;number&gt;") while staying on the Opportunity page. Look the new
  record up via `snQuery` on its back-reference (`source_opportunity=...`)
  rather than a URL change or scraping the toast link.
- A Quote's **Assigned To and Internal Signer both default to the account's
  own territory-based Sales Owner**, not the logged-in session user —
  confirmed by comparing against the actual current admin user's sys_id, not
  just asserting a plausible-looking name. Same underlying default as Scene
  1.2's Opportunity `assigned_to`.
- A Quote's **Billing/Shipping address fields never auto-resolve from the
  account's address**, confirmed even when the account has a full
  street/city/state/zip/country populated and "Billing address same as
  shipping" is left unchecked — they simply stay blank (only `country`
  carries a generic "USA" default, unrelated to the account).
- **Contract End Date recalculates live, client-side, the moment Term
  (months) changes** — no Save round-trip needed to see Start + Term − 1
  day reflected in the End Date field. Confirmed by changing Term from 12 to
  24 months and watching End Date shift from one year out to two.
- The **"Auto-renew contract" checkbox visually toggles correctly on
  `.click()`, but Playwright's own `.check()` throws** ("Clicking the
  checkbox did not change its state") even though the screenshot shows it
  checked — a custom-component state-detection mismatch, not a real bug. Use
  `.click()` and confirm the actual outcome via a backend re-fetch
  (`expect.poll`) instead of trusting Playwright's built-in post-check
  assertion for this control.
- **The guided catalog configurator ("Customize" on a configurable product,
  Scene 2.2) is entirely non-functional on `opmsalescrm1`** — an environment
  misconfiguration, not a test-writing problem. It fails instantly with
  "Failed to get session"; the console shows a 401 from
  `https://empksingampalli.demo01.logik.io/auth/exchange` — the Logik.io CPQ
  integration backing this feature is pointed at `empksingampalli`'s tenant,
  not this instance's own. Reproduced on 2 different configurable products,
  so it's not product-specific. No API-level workaround exists (this is a
  UI-only flow). Blocks Scene 2.2 outright, and likely Scene 2.3 (Ramps) too
  since ramps are configured from inside the same guided-configurator UI.
- **Quote Line Items can be seeded directly via the Table API**
  (`sn_quote_mgmt_core_quote_line_item`), bypassing the broken guided
  configurator entirely — required fields observed: `quote`,
  `product_offering`, `price_list`, `short_description`, `line_type`,
  `action`. Pick a simple, non-configurable product offering (query
  `sn_prd_pm_product_offering` with `configurable=false`) so nothing tries
  to route through the configurator. `list_price` is a **computed field**
  driven by the product offering's own price book entry — passing an
  arbitrary value in the insert is silently overwritten by the pricing
  engine, so don't assert on a specific list price you supplied yourself,
  only that pricing ends up non-zero.
- In the Quote header's **"Apply header discount"** dialog, filling the
  discount % field with `.fill()` and immediately clicking **Apply**
  sometimes silently no-ops — the dialog just stays open, no error thrown.
  A ~500ms settle delay between fill and click reliably fixes it. (A
  `.press('Tab')` blur after fill was tried first and made things worse —
  the button rendered focused but the click still didn't register — so a
  plain wait, not a blur event, is the fix.) The "Apply header discount"
  menu item itself has the same popover-duplication quirk as other
  dropdowns/menus in this app (see the "Convert Lead" menu item note above)
  — use `.last()` with a real mouse click at its bounding-box center.
- `snGet()` (`utils/servicenow-api.ts`) defaults to **display values**, not
  raw backend values — a quote's `state` reads back as `"Approved"` /
  `"Requested for review"`, not `"approved"` / `"requested_for_review"`.
  Assert against the display string unless you explicitly pass
  `displayValue: 'false'`.
- **Submitting a quote with no discount applied auto-approves it
  immediately** — clicking "Preview & Submit for Approval" skips the
  preview/request dialog entirely and jumps straight to Approved, with a
  toast reading "No approval conditions are satisfied for this record."
  Only a quote whose state actually satisfies some approval rule's
  condition (e.g. a header discount ≥ a tier's threshold) opens the real
  preview-and-request flow.
- The real approval chain on `opmsalescrm1` is **"Sales Discount
  Management"**, two serial tiers: Tier 1 (approver Cameron Patel_TECH_L2)
  at Discount ≥10%, Tier 2 (approver Marcus Webb_GLOBAL-VP_GLOBAL-ALL) at
  Discount ≥20%. **Chain gating is directly visible, not just inferred**:
  the Approvals tab renders each tier's own "State" text — the active tier
  reads "Requested", a not-yet-active later tier reads exactly **"Not yet
  requested"**. Right after submitting, both tiers can transiently show
  "Not yet requested" for a moment before Tier 1's own request finishes
  processing — poll for the "Not yet requested" match count to settle at
  the expected number rather than asserting on it once.
- **"Generate document" is synchronous and fast** — the resulting
  `sys_attachment` record (query by `table_sys_id=<quote sys_id>`) is
  already queryable within a couple seconds, no long async wait needed
  beyond a normal `expect.poll`. Filename pattern:
  `Quote-<number>-<MM-DD-YYYY hh:mm:ss a>.pdf`.
- **A quote's "PDF expiration date" is just its own `expiration_date`
  field** — confirmed via `sys_dictionary` (`nameLIKEexpir` on
  `sn_quote_mgmt_core_quote`) that no separate document/attachment-level
  expiry field exists on this instance. It's set at quote-creation time
  (Quote Date + 30 days), not computed by document generation itself.
- **Document Template does not auto-populate for a quote inserted directly
  via the Table API** — Scene 2.1's UI-driven quote creation apparently
  leaves a template populated by default, but an API-seeded quote's
  `document_template` stays blank and "Generate document" needs it set
  explicitly to a real, active `sn_doc_template` record (e.g. "Quote Demo
  Template for Solana", sys_id `7e06a6d03bcb4310d5260fa693e45a05`) before
  generation will work.
- The Quote's **`state` raw backend values**: `draft`, `approved`,
  `requested_for_review`, `completed` (display: Draft / Approved /
  Requested for review / Completed). `snUpdate()` needs the raw value;
  `snGet()` reads back the display value (see the `snGet` note above).
- The **Order table is `sn_ind_tmt_orm_order`** ("Customer Order"), with
  **`sn_ind_tmt_orm_order_line_item`** for its lines — found via
  `sys_db_object` lookup (`nameLIKEorm_order`), not a guessable name. An
  order links back to its source quote via its own **`quote`** reference
  field (query `sn_ind_tmt_orm_order` by `quote=<quote sys_id>`, not the
  other way around). Like "Create Opportunity"/"Create Quote", the Quote's
  **"Create order" button doesn't navigate away** — it creates and saves
  the order immediately and shows a toast with a link, staying on the
  Quote page.
- **`sn_ind_tmt_orm_order` cannot be inserted directly via the Table API**
  with just a `quote` reference — it's rejected by Business Rule "Account,
  Consumer or Buyer Org to be set" (the UI's "Create order" action resolves
  those fields server-side from the quote). Go through the UI action to
  produce a real order fixture rather than trying to hand-construct one.
- The **Order's "Submit" confirmation dialog ("Are you sure you want to
  submit the order?") is a well-behaved `role="dialog"`** — unlike the
  "Convert lead" dialog, it renders instantly with no retry loop needed.
  Quirk: scoping an exact-text `getByText()` check to that dialog locator
  finds nothing even though a `getByRole('heading', ...)` check scoped the
  same way finds the heading fine, in the same visually-obvious dialog box.
  Assert the plain-text check unscoped (page-level) instead — the string is
  unique on the page anyway.
- **Order Tasks are auto-generated asynchronously** after an order's state
  flips to `Submitted` — querying immediately after the state-change poll
  resolves can return zero tasks even though they show up a second or two
  later. Poll for task count, don't check once. The table is
  **`sn_ind_tmt_orm_order_task`**, linked back via its own
  **`customer_order`** field — NOT `order`, which exists on the table but is
  always blank in practice (found via a live record, not the dictionary).
  For a single quote-line fixture, exactly 2 tasks generate: "Complete
  customer account validation" and "Compelete address validation" — the
  second is a **real typo in the shipped app data**, not a transcription
  error in this doc.
- **Order Tasks have no bulk-select checkbox** on the order's own "Order
  Tasks" related-list tab on this instance (unlike the Line Items grid,
  which does). Close each one individually by opening its own record and
  clicking the header's **"Close"** button — it sets State straight to
  "Closed complete" with no confirmation dialog. Scoping field is
  `request_type` (display label "Task Category" in the grid), not a field
  literally named `category`; a value of "Order Header" means order-level
  (its `order_line_item` is blank). For a single simple (non-configurable)
  quote line, both generated tasks come back order-level — no line-level
  task appears; that needs a different order composition to exercise.
- Once every Order Task is closed, **Order State flips to "New" and
  Approve/Reject buttons replace the prior header actions** — clicking
  **Approve transitions straight to "Acknowledged"**, no confirmation
  dialog, matching FLOWS.md's own observation exactly.
- **Order Line Items also have no dedicated one-click completion action**
  (unlike Order Tasks' "Close" button) and **no bulk-select checkbox** on
  the order's Line Items grid — open the line's own record, set the plain
  **State** dropdown to "Completed", and Save. Same popover-duplication
  quirk as every other custom dropdown in this app: the option list
  renders duplicated, use `.last()` with a real click after the popover
  settles.
- **Completing the order's line(s) triggers Order State → "Completed" via
  an asynchronous rollup that's noticeably slower/more variable** than
  every other state transition observed in this suite — one run needed
  more than 15s to settle. Poll with real headroom (40s) specifically for
  this step rather than reusing the ~15s timeout that's fine elsewhere.
- Completing the order **automatically creates real downstream records**:
  a Customer Contract (**`sn_pss_core_service_contract`**), a Customer
  Contract Line (**`sn_pss_core_service_contract_line`** — carries the same
  `product_offering`), and a Sold Product
  (**`sn_install_base_sold_product`**) for the account, all found via
  `sys_db_object` lookup (none of these names are directly guessable from
  their UI labels). Consistent with every other related table in this
  suite (e.g. order line items), nothing here auto-cascades on delete — a
  spec that creates them must explicitly delete the Sold Product, then
  Contract Line, then Contract in its own `afterEach`.

- **`sn_ind_tmt_orm_order` and its Order Task/Line Item children accept direct Table API state
  transitions** for precondition-building (unlike `sn_ind_tmt_orm_order` itself at *creation*
  time, which is rejected — see the Business Rule note above): `state: "submitted"` on the
  order, `state: "5"` (Closed complete) on each Order Task, `state: "acknowledged"` on the
  order, and `state: "completed"` on each Order Line Item all fire the same downstream business
  rules a UI click would (task auto-generation, order-state rollup, Contract/Contract
  Line/Sold Product creation) — there is no need to drive Scenes 3.3/3.4/3.5's own UI mechanics
  again just to get a Completed order as a precondition for a later scene's spec.
- **The order-level state rollup to "Completed" is unreliable when driven purely via direct API
  state updates** (as opposed to the full UI-driven flow in order-completion.spec.ts) — one
  observed run left the order sitting at "Acknowledged" indefinitely even though the Contract/
  Contract Line/Sold Product were already created correctly. Contract creation is evidently
  triggered by the Order Line Item reaching `Completed`, independently of whether the *order's
  own* state rollup ever completes — don't gate a later scene's precondition-building on the
  order itself reaching "Completed" if only the downstream Contract/Sold Product actually
  matter for that scene; poll for those directly instead.
- **Contract Line (and Sold Product) creation lags the Contract record itself by a beat** —
  polling only for the Contract's own existence and then immediately querying for its Contract
  Lines can race and come back empty. Poll for each step's own table separately.
- A Quote's own **`auto_renew` field must be set to `true` before the quote is completed** for
  that to propagate all the way down to the resulting **Contract Line's** `auto_renew` field
  (Scene 4.2's key assertion) — confirmed by reproducing both ways: left unset, the contract
  line comes back `auto_renew=false`; set on the quote beforehand, it comes back `true`. The
  **Contract header's own** `auto_renew` checkbox in the UI reflects this same value.
- A Quote's **`term_month` (UI label "Term (months)") must also be set before completion** for
  the Contract's Start/End dates to have a meaningful Term relationship to assert — left unset,
  Contract Start Date still defaults to today but Term/End Date stay blank on the quote, and the
  resulting Contract's own dates are less meaningful to test against.
- **The account record's tab bar has no fixed overflow boundary** — which related-list tabs
  land directly in the visible bar vs. behind "More tabs" varies from run to run (observed
  "Contracts" on both sides across otherwise-identical runs), apparently because the overflow
  point depends on the total label width of whatever tabs currently have non-zero counts, which
  itself varies. A spec that needs one of these tabs should check for the direct tab first and
  only fall back to opening "More tabs" if it isn't there — don't assume either bucket.
- Some tabs' **visible text and accessible `name` disagree on count formatting**: a tab reading
  "Contracts (1)" or "Customer Contract Lines (1)" on screen has an accessible name using a
  comma instead — "Contracts, 1" — confirmed by a direct `getByRole('tab', {name: '...(1)'})`
  assertion finding nothing even though the click that landed on that exact tab, and the grid
  underneath it, both worked correctly. Assert on content that actually appears in the grid
  (e.g. a real record's number/name link) rather than the tab's own label formatting.
- Table names confirmed live via `sys_db_object` (none guessable from their UI labels):
  **`sn_pss_core_service_contract`** ("Customer Contract"),
  **`sn_pss_core_service_contract_line`** ("Customer Contract Line", carries the same
  `product_offering` and a `sold_product` reference), and **`sn_install_base_sold_product`**
  ("Sold Product", has its own `state`/`name`/`account` fields).

- On the Contract's **Customer Contract Lines** grid, the header action buttons (**Modify
  entire line**, **Renew**, **Suspend**, **Cancel**) are **all disabled with nothing selected**
  and enable as soon as any row's own checkbox is checked (and disable again on uncheck) — a
  plain client-side selection-count behavior, not tied to which specific line is selected.
  **Ramps** stays disabled regardless for a non-ramp-eligible line, consistent with the
  existing Ramps-button quirk noted elsewhere in this file.
- **Not every catalog product is sellable** — the product offering's own `sellable` boolean
  field (not readable via a query *filter* through the Table API, ACL-blocked there even
  though it reads fine on a direct record fetch — list all offerings with `sysparm_fields`
  and filter client-side instead) gates several downstream actions. A non-sellable line (e.g.
  "Micro Apps", `sellable=false`) still flows fine through Quote → Order → Contract creation,
  but the Contract Line's own **Renew** dialog explicitly refuses it ("The selected line is not
  sellable and won't be renewed", Renew button stays disabled even with the line checked). Use
  a `sellable=true` product for anything touching renewal — e.g. "Generators Monthly"
  (`sn_prd_pm_product_offering` sys_id `0ff43ddc3b0f0310d5260fa693e45a73`), which also has
  proper recurring price-list pricing (`pricing_method: "Recurring"`, monthly periodicity) —
  unlike some other sellable-but-untested products (e.g. "Cloud Solution") which have **no**
  `sn_csm_pricing_price_list_line` entry at all and price at a flat $0, and additionally never
  triggered downstream Contract/Contract Line creation on order-line completion (only a Sold
  Product was created) — likely because the completion logic needs a non-zero/recurring price
  to have something to build a contract line schedule from. Check for a real price-list line
  before trusting a "sellable" product will behave like a normal subscription line end-to-end.
- **[RESOLVED 2026-10-01 — passes 3/3 on `opmsalescrm1`, cause of fix unknown; kept for history if it recurs]** **Contract Line Renewal (Scene 5.8) was broken on `opmsalescrm1` at the platform level** —
  the Renew dialog itself (auto-populated expiry/renew-from dates, the sellable-guard above,
  the editable early-renewal date field) all work correctly, but clicking **Renew** throws a
  Critical "Unable to create an order/quote/opportunity. Contact your system administrator."
  alert every time, reproduced identically with both an early date and the untouched default.
  It's a genuine partial failure, not a pure no-op: a new Quote **is** created (Draft state)
  but never linked back (`source_opportunity`/`existing_contract` stay blank,
  `auto_generated_for_renewal` stays `false`), and no Opportunity is created at all. A second
  attempt surfaces "There are already renewal opportunities or quotes for this contract" —
  confirming the orphaned partial Quote from the first attempt. No API-level workaround exists
  (UI-only mechanism). Clean up any such orphaned Quote manually if you reproduce this.
- **`opmsalescrm1` shares the exact same Sales Forecasting seed data as `empksingampalli`** —
  every sys_id in FLOWS.md's Case 1/Case 2 fixtures (headers, and by extension their items)
  exists on `opmsalescrm1` with identical dollar amounts, contrary to the doc's own expectation
  that a different instance's data wouldn't match. No fixture-building was needed at all; the
  spec queries these real (non-disposable — don't delete them) records read-only.
- **`sn_sales_forecast_item` rows exist at multiple time granularities simultaneously for the
  same header** — week (e.g. "2026 Week 37"), month ("2026 September"), and quarter ("2026
  Q3") rows all coexist per category, each with its own `hierarchy_forecast`/`base_forecast`
  value. Only the row whose `period` equals the **header's own** `period` (the quarter, for a
  quarterly forecast) holds the real, authoritative total — the week/month rows are a separate
  breakdown, not additive components of it. Summing `hierarchy_forecast` across all of a
  header's items (not filtering by period) wildly overcounts (observed 2-8x the correct value
  depending on how many non-zero breakdown rows happened to exist). Filter explicitly:
  `forecast_header=<id>^period=<header's own period business_calendar_span sys_id>`.
- The `sn_sales_forecast_item.forecast_header` field is named **`forecast_header`**, not
  `header` — guessing `header` fails query-time with a generic "Insufficient rights to query
  records" ACL error (misleading; the real issue is the field doesn't exist under that name,
  not a permissions problem). The same misleading ACL error appears when filtering
  `sn_prd_pm_product_offering` by its real `sellable`/`configurable` fields directly in a query
  (though reading them via `sysparm_fields` on an unfiltered/differently-filtered request works
  fine) — when this error appears, verify the field name via `sys_dictionary` before assuming
  it's a genuine permissions issue.
- A Quote Line Item's/Contract Line's currency-type fields (e.g. `hierarchy_forecast`,
  `list_price`) come back from the Table API as **plain comma-formatted numbers with no
  currency symbol** when `sysparm_display_value=true^sysparm_exclude_reference_link=true`
  (e.g. `"1,708,000"`, not `"$1,708,000.00"`) — strip commas before `parseFloat`, don't assume
  a `$` prefix needs stripping too.
- **`opmsalescrmgd` (Gold) intermittently creates TWO Contract records for one order
  completion**, not one — observed once in ~6 runs of `contract-amendment-initiation.spec.ts`
  (reproduced, then not reproduced on immediate re-run: genuinely intermittent, not
  deterministic). The two contracts differed in `auto_renew` (one `true` matching the source
  quote, one `false`) and were created ~1 second apart, both otherwise-normal single-line
  contracts. Root cause not confirmed, but the leading theory is a live CPQ-Logik.io
  integration path firing an extra contract-sync in addition to native platform automation — a
  path that can never fire on `opmsalescrm1`, where that integration is misconfigured/broken.
  This looks like a genuine product-level duplicate-creation defect worth flagging to the team,
  not a test bug — the suite's `.toBe(1)` assertion is correct and caught it. Every spec that
  asserts "exactly one Contract" now defensively cleans up *all* matching contracts/contract
  lines/sold products for the account in `afterEach` (not just the one sys_id the test body
  picked), so a recurrence doesn't orphan records regardless of whether the assertion itself
  passes or fails.
- **Not every `sellable=true` product actually behaves like a normal subscription line** —
  seed data has products that are sellable but price at a flat $0 with **no**
  `sn_csm_pricing_price_list_line` entry at all (e.g. "Cloud Solution"). Such a line completes
  through Order fine but never triggers downstream Contract/Contract Line creation on
  order-line completion — only a Sold Product gets created, and polling for a Contract just
  times out with zero results, no error, no syslog entry. Confirmed by waiting 2+ minutes
  directly against the API before diagnosing it. Verify a candidate product actually has a
  real price-list line (and non-zero Total Amount on the quote) before trusting it end-to-end
  — "Generators Monthly" (`sn_prd_pm_product_offering` sys_id
  `0ff43ddc3b0f0310d5260fa693e45a73`) is confirmed to work correctly and is also `sellable=true`
  (needed for Scene 5.8/Renewal, which "Micro Apps" — `sellable=false` — cannot exercise at
  all, per its own guard).
- **Contract Line Renewal (Scene 5.8) works correctly on `opmsalescrmgd` (Gold)** — confirmed
  by directly reproducing the exact same dialog/click sequence that fails on `opmsalescrm1`,
  twice (default Renew-from date and an early date): a real, properly-linked Opportunity +
  Quote get created both times, no Critical error. This confirms the `opmsalescrm1` failure is
  specifically that instance's broken CPQ-Logik.io tenant connection, not a universal platform
  defect — see `tests/contract-renewal.spec.ts` (run via
  `E2E_ENV_FILE=.env.opmsalescrmgd npx playwright test tests/contract-renewal.spec.ts`; it is
  the only spec in the suite authored against Gold instead of `opmsalescrm1`, and is not
  expected to pass there). One divergence from FLOWS.md even on Gold: the *original* contract
  line's own state/end date did not visibly change to reflect early termination within the
  observed window — stayed `Active` with no `end_date` value change. Not asserted in the spec.
- **New Opportunity/Quote records created by an async action (like Renew) can appear in a
  partially-populated state before their own linking fields settle** — the new Quote row
  existed (queryable, correct count) before its `source_opportunity` reference populated,
  observed as a real ~1-6s gap. Poll on the specific field you need truthy, not just on record
  count existing — a `.toBe(2)` length check can pass while the field you read immediately
  after is still blank.

## 4. Fixture / cleanup pattern

Every spec creates its own disposable fixture data via the REST API
(`utils/servicenow-api.ts`) rather than mutating real golden demo records —
critical, since this instance's data is shared and used for live demos.
Currently each spec hand-tracks its own created sys_ids in `let` variables and
deletes them in `afterEach`. This is fine for one spec; once more specs exist,
promote it to a shared `RecordCleaner`-style helper: a small registry that
any step in a test can call `cleaner.track(table, sysId)` on, and one
`afterEach` deletes everything tracked, in reverse order, regardless of which
step created it or whether the test failed partway through.

Naming convention for fixture data (so it's unmistakably disposable, and
distinguishable from real demo records if a cleanup ever fails):
`company: 'QA Automation Test Co'`, `last_name` prefixed `QA Test`, etc. Never
add tool/model attribution text to any field — same hard rule as
`demo-data/SEEDING-REFERENCE.md` for seeded demo data.

## 5. Authoring a new flow — process

1. Add (or find) the flow's description in `FLOWS.md`, with whatever record
   numbers/expected amounts are known — check `CATALOG.md` first so it's not
   already covered or in progress.
2. Explore the live UI first via the Playwright MCP tools against a
   **disposable fixture record** created through the API, never against a
   real golden demo record. Never guess selectors.
3. Write the spec against that exploration, re-run it 2-3 times to catch
   flakiness before considering it done (see the `Status` field above).
4. Add any new UI quirks discovered to that domain's `KNOWN-QUIRKS.md`.
5. Update the flow's row in `CATALOG.md` (spec file, status, last verified).

## 6. Continuous regression detection

Once there are a few flows: a scheduled CI job (nightly cron) running
`npm run test:e2e`, using the JUnit reporter already configured in
`playwright.config.ts`, with the HTML report + screenshots/videos uploaded as
artifacts on failure, and a Slack/email notification on failure. This is the
actual "know right away" mechanism — everything above just keeps the suite
maintainable as flows accumulate.
