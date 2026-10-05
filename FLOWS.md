# Flow Backlog — Sales CRM Golden Demo E2E Suite

This is the input backlog: plain-language descriptions of flows to cover,
written by whoever thinks of them. No structure required beyond a name and
a description — add expected values/numbers when you have them, since those
become the test's actual assertions instead of vague "looks right" checks.

`CATALOG.md` is the derived, tracked output (spec file, domain, status) —
edit this file freely; ask for `CATALOG.md` to be regenerated/updated
whenever you add or change something here.

Domain tag is optional (used to group specs into folders once there's more
than a couple per domain — see TESTING-STRATEGY.md §2). Leave it off and it
gets inferred.

---

## Source: the Sales CRM Demo Clickpath

Scenes 1.1 through 5.8 below are transcribed from
`guidde_pipeline/solana-clickpath/index.html` — a click-by-click demo script
covering the full quote-to-cash lifecycle for the Golden Gate AI Corp
account / Asher Sky (AE), recorded against a run of the demo instance. It's
the source of truth for exact click sequences and has a screenshot for every
step (`guidde_pipeline/solana-clickpath/screenshots/<scene>-*.png`) — read it
directly when authoring a spec for one of these scenes, rather than relying
only on the condensed description here.

**Important caveat carried over from that doc:** the specific dates, dollar
amounts, and record numbers (quote/order/contract numbers) it shows are just
what *that one run* produced — Contract Start Date defaults to *today* when
a quote is created, so re-running this on `opmsalescrm1` or `opmsalescrmgd`
will produce different actual values. Only the *relationships* between them
are invariant (End Date = Start + Term; Quote Expires = Quote Date + 30
days; a 20%+ discount triggers specific approval chains; ramp segments
recompute to reach a new ceiling). Write assertions against those
relationships and against whatever your own test run actually produces —
never against the literal numbers quoted below, which are illustrative only.

Also carried over: Module 6 (PRM / partner-led quoting) is **planned, not
built** in the demo instance as of this doc — nothing to test there yet.

---

## Lead to Opportunity conversion (= Clickpath Scene 1.1)

**Domain:** sfa
**Status:** built, passing (`tests/lead-to-opportunity.spec.ts`)

Qualifying a Lead (setting its Stage to "Qualified") in the CRM Workspace
auto-opens a "Convert lead" dialog that creates an Account, Contact, and
Opportunity together. Verify all three get created, the Lead's stage and
closed_date update, and the Opportunity's short_description/account match
what was on the Lead.

This is the same flow as Clickpath Scene 1.1 ("SDR Lead Qualification" —
persona Sage Reed, SDR), minus the outreach-email/meeting-scheduling
preamble the clickpath shows (compose email → follow-up email → schedule a
meeting → THEN move Stage to Qualified). The doc calls Scene 1.1 an
*optional* entry point — real demos can skip straight to Scene 1.2 below,
opening the Opportunity directly on an existing account/contact with no lead
involved. If ever asked to extend this spec into a fuller SDR-touch flow,
the outreach/meeting steps are documented in the clickpath under Scene 1.1,
steps 5–14.

---

## Scene 1.2 — Opportunity Creation from an existing Account

**Domain:** sfa
**Status:** built, passing (`tests/opportunity-from-account.spec.ts`)

Persona: Asher Sky (AE). From an existing Account's own record (Golden Gate
AI Corp, via **My Lists → All Accounts**), open **Opportunities → New**.
Verify Account and Contact auto-populate from the parent account context
with no re-keying, but **Industry does not auto-populate** — it must be
picked manually. Stage defaults to "Qualification". Assert the created
Opportunity is linked to the correct account/contact and is visible to the
account's territory-based ownership (owner's manager can see it without
manual assignment) — that visibility check may need a second persona/
impersonation to verify.

**Verified behavior on `opmsalescrm1` diverges from the paragraph above** (a
different instance than the clickpath this was transcribed from): the
account's own header exposes a single **"Create Opportunity" button** that
skips a fillable form entirely — it creates and saves the Opportunity
server-side immediately. Industry *does* auto-populate from the account's
Industry; Contact does *not* (confirmed empty even with the account's
primary_contact set). Territory and Owner (`assigned_to` in the backend) do
auto-inherit from the account with no manual step, which is the actual
mechanism satisfying the territory-based-ownership assertion — the
cross-persona manager-visibility check was not separately built, per the
"may need a second persona" hedge above. See TESTING-STRATEGY.md §3 for
details.

---

## Scene 2.1 — Quote Creation from Opportunity

**Domain:** cpq
**Status:** built, passing (`tests/quote-from-opportunity.spec.ts`)

Persona: Asher Sky (AE). On an Opportunity, click **Create Quote**. Assert:
- Account, Contact, and Source Opportunity (back-reference) auto-populate
  on the new Quote header with zero re-keying; Assigned To defaults to the
  current user.
- Pricing section defaults Price List → "Standard Price List" and Cost Book
  → "Standard Cost Book".
- Setting Contract Start Date + Term (months) auto-calculates Contract End
  Date as Start + Term (relationship to assert, not a literal date).
- Setting Auto-renew contract → true persists.
- Renewal Adjustment Basis/Type/Value (e.g. "Contracted Price" / "Markup %"
  / a percentage) set here later becomes the default carried into the
  eventual renewal quote (Scene 5.8) — a cross-scene relationship worth a
  regression check once both specs exist.
- Billing/Shipping location fields resolve from the account's own address
  records (not typed manually) when "Billing address same as shipping" is
  left unchecked.
- Quote Document Details' External Signer auto-populates from the account's
  primary contact; Internal Signer defaults to the current user.
- Quote saves in Draft, Version 1, with $0.00 totals (totals only populate
  once line items are added in Scene 2.2).

**Verified behavior on `opmsalescrm1`:** most claims above hold exactly as
described — Account/Contact/Source Opportunity auto-populate, Price
List/Cost Book default correctly, Contract End Date recalculates live off
Start + Term (confirmed by changing Term from 12→24 months and watching End
Date shift accordingly with no save round-trip needed), Auto-renew persists,
External Signer auto-populates from the account's primary contact, and the
Draft/Version 1/$0.00 state all match. Two real divergences: **Assigned To**
and **Internal Signer** default to the account's own territory-based Sales
Owner (inherited via the Opportunity), not the current session user as this
paragraph claims. **Billing/Shipping do not auto-resolve** from the
account's address at all — confirmed still blank even with the account's
street/city/state/zip/country fully populated and "same as shipping" left
unchecked. See TESTING-STRATEGY.md §3 for details.

---

## Scene 2.2 — Catalog & Guided Product Configuration

**Domain:** cpq
**Status:** built, passing (`tests/catalog-guided-configuration.spec.ts`)

**Blocker found on `opmsalescrm1` (2026-09-22):** the guided configurator
(the "Customize" button on any configurable product in the Catalog tab)
fails immediately with "Failed to get session" — confirmed via console logs
to be a 401 from `https://empksingampalli.demo01.logik.io/auth/exchange`.
The Logik.io CPQ integration that powers this configurator is pointed at
`empksingampalli`'s tenant rather than `opmsalescrm1`'s own, so no session
can ever be established here. Reproduced on 2 different configurable
products (Solana Revenue Enablement Platform, Power Generator) — not
product-specific. There's no API-level shortcut for this UI-only flow, so
it can't be tested until this is fixed at the platform/admin level. Scene
2.3 (Ramps) likely shares this same blocker since ramps are configured from
inside the same guided-configurator UI — worth re-checking once this is
fixed, rather than assuming it's separately blocked.

**Re-tested on `opmsalescrm1`, 2026-09-30 — the CPQ-Logik.io tenant
misconfiguration is fixed; the configurator now works end-to-end.**
`auth/exchange` now returns 200 against `opmsalescrm1.demo01.logik.io` (its
own tenant, confirmed via live network inspection). Opened "Customize" on
both "Solana Revenue Enablement Platform" and "Power Generator," configured
each (Bundle Selection fields — Industry/Use Case/Region/CRM
connector/license quantities for the first; a multi-tab Generator
Model/Engine/Fuel System/Cooling System/Extras config for the second),
clicked the commit button ("Save and Close" or "Quote" depending on the
product's configurator layout), and confirmed a real
`sn_quote_mgmt_core_quote_line_item` was created and synced back — verified
directly against the table, not just the UI toast.

**One real gotcha hit along the way, unrelated to CPQ-Logik.io:** the
commit step throws a Critical "Quote line item(s) could not be created" if
the target Quote's own `account` and `consumer` fields are both empty — a
pre-existing mandatory-field Business Rule ("Validate mandatory fields on
quote", `sn_quote_mgmt_core_quote_line_item`, table
`sn_quote_mgmt_core_quote_line_item`) aborts the insert either way. This
bit an API-seeded test fixture quote that never had `account` set. A
UI-created quote (via an Opportunity's "Create Quote") always has `account`
populated, so this won't affect normal flows — but any future spec here
that seeds its quote fixture directly via the Table API (the established
pattern elsewhere in this suite, e.g. `pricing-adjustments.spec.ts`) MUST
set `account` (or `consumer`) on the quote, or the configurator commit will
fail with this same error.

**Spec built 2026-09-30 (`tests/catalog-guided-configuration.spec.ts`), 3
consecutive clean runs.** Covers: opening "Customize" on "Solana Revenue
Enablement Platform," confirming the Industry field auto-populates (a
signal the CPQ-Logik.io session established correctly), setting Standard
User Licenses to 250, committing via "Save and Close," and verifying via
direct table query that a real Quote Line Item synced back
(`short_description: "Solana's Root Product Offering"`, after trimming —
the field carries trailing `\n\n`). **Narrower in scope than FLOWS.md's own
description below, with one real finding:** configuring only the bundle's
own Bundle Selection fields (no separate catalog item explicitly "Added")
produces exactly **one** line item (the root), not one per configurator
field — and both that line's own price fields and the quote header's
`total_amount` stay genuinely `$0.00` (polled 20s, confirmed not a timing
issue) rather than reflecting the licensed quantities. Getting non-zero
pricing appears to need either a catalog item actually "Added" separately
or a manual Reprice — out of scope for this spec, whose assertion is the
line-item sync-back mechanism itself, not the resulting price. The
"derived pricing," "Preview & Submit for Approval/Generate Document newly
appear," and "Total = Monthly × Term" assertions below are NOT covered by
this spec — they'd need a fixture that actually adds separately-priced
catalog items, which this one deliberately doesn't do (kept minimal to
isolate the sync-back mechanism). Worth a follow-up spec if those
assertions matter.

Persona: Asher Sky (AE). On the Quote's **Catalog** tab, drill into a
category (e.g. "Top-Level Configurable Products") and click **Customize** on
a configurable product to launch the guided configurator. Set bundle
selection fields (Industry — defaults from the account; Use Case; Region;
Customer Segment) and a CRM connector choice, then enter license quantities
for multiple tiers (e.g. Standard/Partner/Viewer counts). Assert:
- Some cart lines are **derived pricing** — tied to another line's quantity
  rather than priced independently (e.g. a "Platinum Support" line and a CRM
  connector line derive from the Standard License count) — changing the
  driving quantity should recalculate the derived lines automatically.
- **Save and Close** syncs the entire configured cart back to the Quote as
  individual priced line items, all inheriting the same Contract Start/End
  dates set in Scene 2.1.
- Quote header's Total Amount = Total Monthly Price × the Term (months) set
  in Scene 2.1 — assert that multiplication relationship holds, not a fixed
  dollar figure.
- Once line items exist, **Preview & Submit for Approval** and **Generate
  Document** buttons newly appear on the quote header (they weren't present
  at $0 totals).

---

## Scene 2.3 — Ramps

**Domain:** cpq
**Status:** built, passing (`tests/ramps.spec.ts`)

**Re-tested on `opmsalescrm1`, 2026-09-30 — works, same root cause as 2.2.**
On the quote used to verify 2.2 (`QT0001638`, which now has a real
"Solana Revenue Enablement Platform" line with a 36-month contract term),
selecting that line's checkbox correctly enabled the **Ramps** button
(alongside Co-terminate/Copy/Delete, all previously disabled) and opened
the "Price ramps for Solana Revenue Enablement Platform" dialog. Start/End
date auto-populated from the line's own contract dates (09-30-2026 /
09-29-2029), Ramp type defaulted to "Yearly," and Segments auto-derived to
**3** from the 36-month term — exactly matching the description below. A
banner also confirmed "Ramps are applied to child lines as well." The
dialog also surfaced one live platform note: "The annual percent increase
(API) was not honored as some of the segments are not full length" —
relevant if a future spec sets a non-zero Annual % Increase.

**Spec built 2026-09-30 (`tests/ramps.spec.ts`), 3 consecutive clean runs.**
Doesn't depend on the guided configurator at all — the fixture seeds a
Quote Line Item directly via the Table API with `term_month: "36"` set
(there's no dedicated "is this line recurring" flag on
`sn_quote_mgmt_core_quote_line_item`; confirmed live that the Ramps button
is driven by the product offering's own type, not a line-item field, so
reusing the same recurring product from Scene 2.2's fixture is what makes
this work on an API-seeded line). Covers: Ramps button starts disabled with
nothing selected, enables on selecting the line's checkbox, opens the
dialog, and confirms Ramp type "Yearly" + Term 36 months auto-derives
Segments to 3. Does NOT cover: actually clicking Create, editing segment
quantities, the post-creation Line Items grid's "Ramp" column, or the
cumulative-total-updates-as-segments-are-edited assertion — those would
need a follow-up spec that goes past dialog-open into the create flow.

Persona: Asher Sky (AE). On a Quote's **Line Items** tab, select a
recurring/subscription-flagged line's checkbox (this enables a **Ramps**
button in the toolbar, alongside Co-terminate/Copy/Delete — buttons that
stay disabled for non-ramp-eligible product lines, worth a negative
assertion). Open the **Price ramps** popup: Start/End date and Term default
from the contract; Ramp Type → "Yearly" auto-derives the segment count from
the term (e.g. a 36-month term yields 3 yearly segments). Click **Create**,
then edit each segment's quantity to build a phased rollout (e.g.
100 → 200 → 300). Assert:
- Cumulative total across segments updates as quantities are edited.
- After creating the ramp, the line item's own Term/Contract dates shrink to
  match only the *first* segment's window, not the full contract term — the
  ramp record itself carries the full multi-segment schedule.
- The Quote header's Total Monthly Price / Total Amount drop to reflect the
  ramped (lower) starting quantity, compared to their values before the ramp
  was applied.
- The Line Items grid shows a **Ramp** column referencing the created ramp
  record.

---

## Scene 2.4 — Pricing & Adjustments (header discount)

**Domain:** cpq
**Status:** built, passing (`tests/pricing-adjustments.spec.ts`)

Persona: Asher Sky (AE). From the Quote header's **...** action menu, select
**Apply header discount**. In the dialog, leave "Apply discount to all quote
lines" selected, enter a discount percentage large enough to cross this
org's approval threshold (the doc uses 20%, which does trigger approval —
confirm the actual threshold on whichever instance this runs against), and
click **Apply**. Assert:
- The Line Items grid's *Unit Adjustment* column populates across every
  line immediately after Apply — no separate Save step required for the
  discount to flow down to lines.
- Per-line adjustment is **not** necessarily a flat percentage of every
  line's own list price (the clickpath observed uneven allocation across
  lines) — don't assert a fixed percentage per line; assert only that some
  adjustment is present and non-zero.
- A discount at/above the approval threshold is what makes the Approvals
  flow (Scene 2.5) actually trigger — useful as a setup precondition for
  that spec rather than a fully separate test, if convenient to combine.

**Verified behavior on `opmsalescrm1`:** matches the paragraph above closely.
A 30% header discount populates Unit Adjustment and Total Adjustment on
every line immediately after clicking Apply, with no separate Save — the
Quote's total drops accordingly and its state stays Draft (applying the
discount alone does not submit for approval; that's the separate "Preview &
Submit for Approval" action). Line Items for this spec's fixture Quote were
seeded directly via the Table API (`sn_quote_mgmt_core_quote_line_item`)
rather than the guided configurator, since that's currently blocked (Scene
2.2). One divergence not fully resolved: **the actual discount percentage
that triggers the approval requirement was not independently confirmed** —
there's no simple `sys_properties` value holding it, and chasing it further
was out of scope here. Left as an open question for Scene 2.5, which
addresses the Approvals flow directly. See TESTING-STRATEGY.md §3 for the
Quote Line Item seeding technique and a UI timing quirk found in the
discount dialog.

---

## Scene 2.5 — Approvals

**Domain:** cpq
**Status:** built, passing (`tests/quote-approvals.spec.ts`)

Personas: Asher Sky (submits); a chain of approvers impersonated in turn
(the doc's run used a Territory Manager, then a Discount Management chain
of increasing severity, then a Payment/Delinquent-Account check — the exact
roles/names will differ per instance; discover live). From the discounted
Quote header, click **Preview & Submit for Approval**, review the
auto-assembled approval chains, add an optional note, and click **Request
Approval**. Assert:
- Quote State → "Requested for review"; the header action button changes to
  "Recall approval request".
- Approval chains gate each other in order (e.g. all approvals in an earlier
  chain must clear before the next chain's approvers even see a request) —
  worth asserting the second chain's tiles aren't actionable/visible until
  the first chain fully clears.
- Within a chain, approvals can themselves be serial (escalating by
  severity/tier) rather than parallel.
- **Known workaround from the source doc:** approving directly from a tile
  in the Approvals tab may not work due to a UI bug at the time the doc was
  written — the actual click path is tile → open the Approval Request →
  Approvers tab → open that Approval Step record → set State → Approved →
  Save. Verify whether this bug still exists on the target instance before
  assuming which path to automate; if it's since been fixed, prefer the
  simpler tile-level action.
- Once every chain fully clears, the quote reaches an Approved state (final
  assertion after walking or shortcutting through all approvers).
- **Possible test shortcut:** an admin can set the quote's State directly to
  Approved to skip walking every approver — useful for specs further down
  the chain (Doc Gen, Order Creation) that need an approved quote as a
  precondition but aren't themselves testing the approval chain.

**Verified behavior on `opmsalescrm1` diverges from the paragraph above in
one important way — the actual threshold — and confirms the rest of the
mechanism directly:** a quote with **no discount at all auto-approves
immediately** on clicking "Preview & Submit for Approval" — the platform
skips straight to Approved with a toast reading "No approval conditions are
satisfied for this record", no preview dialog, no chain. The real approval
chain here is a single **"Sales Discount Management"** chain with two
serial tiers, not the three separate chains (Territory Manager → Discount
Management → Payment/Delinquent-Account) the source doc's run showed —
those may be specific to that account/scenario (e.g. a delinquent account)
and weren't reproduced with this spec's plain fixture. The two tiers found:
**Tier 1** (approver Cameron Patel_TECH_L2) triggers at **Discount ≥10%**;
**Tier 2** (approver Marcus Webb_GLOBAL-VP_GLOBAL-ALL) triggers at
**Discount ≥20%** — so this doc's "20%" is actually the Tier 2 boundary, not
the point approval first becomes required. Chain gating is directly
observable (not just inferred): the Approvals tab shows each tier's own
"State" label — Tier 1 reads "Requested" while Tier 2 reads **"Not yet
requested"** until Tier 1 clears. Quote State does move to "Requested for
review" and the header button does swap to "Recall approval request",
exactly as described. **Not verified**: actually impersonating an approver
to click-approve (so the tile-click UI bug this doc describes is neither
confirmed nor ruled out here — it would need a real approver session, out
of scope for this spec), and the Territory Manager / Payment-Delinquent
tiers. See TESTING-STRATEGY.md §3.

---

## Scene 2.6 — Document Generation

**Domain:** cpq
**Status:** built, passing (`tests/document-generation.spec.ts`)

Persona: Asher Sky (AE). On an Approved quote, click **Generate document**.
Assert:
- A PDF attachment appears in the quote's Attachments panel shortly after.
- The PDF's filename encodes the quote number and a generation timestamp
  (no manual naming).
- The PDF's expiration date = Quote Date + 30 days (relationship to assert,
  not a literal date) — the doc calls this "a real, verified expiration
  window".
- The Document Template field (set back in Scene 2.1) must be populated for
  generation to render — worth a guard/precondition check if this spec is
  built standalone rather than chained after 2.1.
- From the **...** menu, **Mark as complete** transitions Quote State →
  "Completed", and a **Create order** button newly appears in place of the
  prior action buttons (Recall/Reprice/etc.) — this is the actual
  sales-to-fulfillment handoff point into Module 3 (Order Management).

**Verified behavior on `opmsalescrm1` matches the paragraph above closely:**
"Generate document" attaches a real PDF (`application/pdf`) whose filename
encodes the quote number and a generation timestamp, e.g.
`Quote-QT0001290-09-22-2026 09:31:04 AM.pdf` — no manual naming. The
"PDF's expiration date = Quote Date + 30 days" claim turns out to be the
Quote's own `expiration_date` field itself (confirmed via `sys_dictionary`:
there is no separate document/attachment-level expiry field on this
instance) — it's set to Quote Date + 30 days at quote-creation time, not
something document generation computes separately. Document Template must
indeed be populated for generation to work, but — divergence — it does
**not** auto-populate for a quote created directly via the Table API the
way a UI-driven Scene 2.1 quote apparently does; had to set it explicitly
to a real `sn_doc_template` record. Mark as complete → State "Completed"
and "Create order" appearing in place of "Reprice" both confirmed exactly
as described. This spec used the "admin can set State directly to
Approved" shortcut this doc itself suggests, since Scene 2.5 already tests
the approval mechanism. See TESTING-STRATEGY.md §3.

---

## Scene 3.1 — Order Creation

**Domain:** om
**Status:** built, passing (`tests/order-creation.spec.ts`)

Persona: Asher Sky (AE). On a Completed quote, click **Create order**.
Simplest possible assertion: an Order record gets created, linked back to
the source quote, in an initial Draft-like state, carrying over the same
line items.

**Verified behavior on `opmsalescrm1` matches this simple assertion
exactly:** "Create order" creates and saves the Order (`sn_ind_tmt_orm_order`
— "Customer Order") server-side immediately, same no-navigation-just-a-toast
pattern as "Create Opportunity" and "Create Quote" elsewhere in this app.
The order's own `quote` field links back to the source quote, `state` starts
as `Draft`, and one `sn_ind_tmt_orm_order_line_item` is created per quote
line item carrying the same product offering. Used the "admin can set State
directly" shortcut (jumping the quote straight to Completed) as this spec's
precondition, since Scenes 2.5/2.6 already cover approval and document
generation. See TESTING-STRATEGY.md §3.

---

## Scene 3.2 — Order Assignment & Review

**Domain:** om
**Status:** built, passing (`tests/order-review.spec.ts`)

Persona: an Order Operations persona (the doc uses "Mary Stephens"; confirm
the actual role/username on the target instance). From a **Customer
Orders → All** list (a cross-account queue, not scoped to one AE), locate
the newly created order in Draft and open its **Line Items** tab. Assert
every line item from the source quote carried over intact (same products,
same structure, still in a pre-submission state).

**Verified behavior on `opmsalescrm1` matches exactly:** opening the order's
own record (`sn_ind_tmt_orm_order`) and its Line Items tab shows the
carried-over line item (an `ORDL...` record) with the same product offering
as the source quote line, in a `Draft` state — structurally intact and
pre-submission, as described. **Not verified**: the cross-account,
not-AE-scoped queue visibility itself — that would need a real non-admin
Order Operations session to check ACL-driven visibility, the same scoping
call already made for Scene 1.2's manager-visibility check and Scene 2.5's
approver impersonation. See TESTING-STRATEGY.md §3.

---

## Scene 3.3 — Order Submission

**Domain:** om
**Status:** built, passing (`tests/order-submission.spec.ts`)

Persona: Order Operations. Click **Review & Submit** — a review screen
itemizes quantity, unit price, and cumulative pricing per line. Click
**Submit**, confirm the "are you sure" dialog. Assert:
- Order State → "Submitted".
- Order Tasks are auto-generated (a specific count appears on the Order
  Tasks tab) — assert count > 0 and tasks exist, rather than a hardcoded
  count that may differ by order composition.

**Verified behavior on `opmsalescrm1` matches exactly:** "Review & Submit"
opens a "Review order" screen itemizing Qty/Unit list price/cumulative
pricing per line, same as described. Clicking the header's "Submit" opens a
"Confirmation" dialog reading "Are you sure you want to submit the order?"
(this one, unlike the "Convert lead" dialog, renders instantly and exposes a
proper `role="dialog"` container — no retry loop needed). Confirming moves
Order State → `Submitted`, and exactly 2 Order Tasks get auto-generated for
this single-line fixture (both "In progress") — real short descriptions
observed: "Complete customer account validation" and "Compelete address
validation" (the second is a genuine typo in the shipped app data, not a
transcription error here). Task generation runs asynchronously after the
state flip, so the spec polls for it rather than checking once immediately.
See TESTING-STRATEGY.md §3.

---

## Scene 3.4 — Order Task Fulfillment

**Domain:** om
**Status:** built, passing (`tests/order-task-fulfillment.spec.ts`)

Persona: Order Operations. On the **Order Tasks** tab, note tasks split
across categories — some line-level (tied to a specific order line item),
some order-level (order-wide, e.g. account/address validation). Bulk-update
all tasks' State → "Closed complete". Assert:
- Once every task is closed, Order State flips (the doc observed → "New")
  and an **Approve** (with Reject) button newly appears.
- Clicking Approve transitions Order State → "Acknowledged".
- Each task should have distinguishable line-level vs. order-level scoping
  (category field) — worth asserting the split isn't uniform if the order
  has both types of tasks.

**Verified behavior on `opmsalescrm1` matches exactly** for State
transitions: closing every Order Task really does flip Order State →
`New` and replace the prior action buttons with **Approve**/**Reject**;
clicking Approve moves it straight to `Acknowledged` with no confirmation
dialog. Mechanics differ from the paragraph above: there's no bulk-select
checkbox on the Order Tasks related list on this instance — each task is
closed individually via its own record's header **"Close"** button (sets
State directly to Closed complete, no dialog). For this spec's single
simple line item, both auto-generated tasks come back scoped
**order-level** (`request_type` = "Order Header", `order_line_item` blank)
— no line-level task appears, so the "distinguishable line-level vs.
order-level split" assertion wasn't exercised; would need an order
composition that actually produces a line-level task. See
TESTING-STRATEGY.md §3.

---

## Scene 3.5 — Order Completion & Fulfillment

**Domain:** om
**Status:** built, passing (`tests/order-completion.spec.ts`)

Persona: Order Operations. On the order's **Line Items** tab, bulk-update
every line's State → "Completed". Assert:
- Order State → "Completed" once every line is completed.
- Completing the order **automatically creates** the Contract, Contract
  Lines, and Sold Products records for the account (no separate manual step)
  — the real assertion here is checking those downstream records exist

**Verified behavior on `opmsalescrm1` matches exactly:** completing every
order line really does flip Order State → `Completed`, and a Contract
(`sn_pss_core_service_contract`, "Customer Contract"), a Contract Line
(`sn_pss_core_service_contract_line`, "Customer Contract Line" — carrying
the same product offering), and a Sold Product
(`sn_install_base_sold_product`) all appear for the account with no manual
step. Mechanics differ from "bulk-update" in the paragraph above: there's
no bulk-select on the Line Items grid either (same gap as Order Tasks in
Scene 3.4) — set the plain State dropdown on the line item's own record to
"Completed" and Save (same popover-duplication quirk as every other custom
dropdown here). The order-level rollup to `Completed` after the line
change is genuinely slower/more variable than other state transitions in
this suite — observed needing more than 15s on one run, so the spec polls
with a 40s timeout specifically for that step. See TESTING-STRATEGY.md §3.
  immediately after order completion, which sets up Scenes 4.1–4.3.

---

## Scene 4.1 — Contract Review

**Domain:** contracts
**Status:** built, passing (`tests/contract-review.spec.ts`)

Persona: Asher Sky (AE). From the account's **Contracts** tab, assert
exactly one new Contract record exists, generated automatically from the
just-completed order (no manual creation step), with Start/End dates
consistent with the Term set back on the quote (Scene 2.1)'s relationship
(End = Start + Term), not a literal date.

**Verified behavior on `opmsalescrm1`:** matches exactly as described —
completing the order's line auto-creates exactly one Contract for the
account with End = Start + Term (12mo) − 1 day. One real quirk: the
account's "Contracts" tab does not have a fixed overflow bucket the way
most other related-list tabs do — it lands directly in the visible tab bar
on some runs and behind "More tabs" on others, depending on which other
related lists currently have counts. The spec checks both. See
TESTING-STRATEGY.md §3.

---

## Scene 4.2 — Contract Lines Review

**Domain:** contracts
**Status:** built, passing (`tests/contract-lines-review.spec.ts`)

Persona: Asher Sky (AE). Drill into the Contract's **Customer Contract
Lines** tab. Assert every product from the completed order is present as
its own contract line (including the parent/bundle line and every child
line), each carrying Term, Start/End dates, and — critically — **Auto-renew
= true at the contract-line level**, not just on the original quote header
(this is what will later drive the Renewal scene, 5.8, so worth a direct
assertion rather than assuming it inherited correctly). If the order
included a ramped line (Scene 2.3), assert its ramp record/reference also
carried over intact onto the contract line.

**Verified behavior on `opmsalescrm1`:** matches as described — one
contract line per order line, with Term/Start/End dates carried over.
Auto-renew=true at the contract-line level is confirmed, but it is
**conditional**: it only comes through true when the source quote's own
`auto_renew` field was set true *before* the quote was completed (the
un-set default produces `auto_renew=false` on the resulting contract line
— confirmed by reproducing both ways). The ramp-carryover half of this
scene is out of scope on this instance for now — it depends on Scenes
2.2/2.3 (guided configurator/ramps), which are blocked by the CPQ-Logik.io
tenant misconfiguration (see Scene 2.2). See TESTING-STRATEGY.md §3.

---

## Scene 4.3 — Sold Products Review

**Domain:** contracts
**Status:** built, passing (`tests/sold-products-review.spec.ts`)

Persona: Asher Sky (AE). On the account's **Sold Products** tab, assert
every product offering the order created appears as its own sold-product
record with a lifecycle State. If a ramped line was involved, assert each
ramp *segment* appears as its own sold-product record with its own state —
e.g. a segment whose window has already started should read "Active" while
a segment starting later reads something like "In Preparation". This is the
most direct place to verify ramp segment lifecycle transitions land
correctly, distinct from just checking the ramp's own schedule fields.

**Verified behavior on `opmsalescrm1`:** the base assertion matches — one
Sold Product per order line, State "Active", visible on the account's Sold
Products tab. The ramp-segment-lifecycle half of this scene (multiple
segments in different states) is out of scope on this instance for the
same reason as Scene 4.2 — it needs Scenes 2.2/2.3 (ramps), which are
blocked. See TESTING-STRATEGY.md §3.

---

## Scene 5.1 — Contract Amendment Initiation

**Domain:** subscription
**Status:** built, passing (`tests/contract-amendment-initiation.spec.ts`)

Persona: Asher Sky (AE). On the account's Contract → **Customer Contract
Lines**, select the root/bundle line item's checkbox. Assert the **Modify
entire line** action only becomes available/enabled once that specific
checkbox is selected (not available with nothing selected, and not
available on a non-root child line — worth a negative check).

**Verified behavior on `opmsalescrm1`:** matches as described for the
checkbox-selection half — "Modify entire line" (and Renew/Suspend/Cancel)
start disabled with nothing selected, enable on checking the line's own
checkbox, and disable again on unchecking it. The root-vs-non-root-child
negative check is out of scope on this instance for now: this fixture's
contract line is a single simple product with no bundle/child structure,
and producing one needs the guided configurator (Scenes 2.2/2.3), which is
blocked by the CPQ-Logik.io tenant misconfiguration. See
TESTING-STRATEGY.md §3.

---

**2026-09-30 — spec-writing for Scenes 5.2-5.7 attempted and paused, not
because the mechanics are wrong.** All six scenes below were manually
re-verified live today (see each scene's own "Re-tested" note) and confirmed
to work exactly as described — the CPQ-Logik.io fix that unblocked 2.2/2.3
unblocked this whole chain too. But while building the actual spec, a fresh
fixture's quote→order handoff ("Create order" on a Completed quote) started
failing intermittently — sometimes the button doesn't render, sometimes it
creates an Order with zero line items. This is NOT specific to the new
fixture: re-running the already-stable `order-creation.spec.ts` reproduced
the same empty-line-items failure on its own established Micro Apps
fixture, proving this is a live instance-stability issue on `opmsalescrm1`
separate from every other blocker tracked in this doc (CSM view change,
CPQ-Logik.io, Renewal's own distinct cause). Spec-writing for 5.2-5.7 was
deliberately paused here rather than built against a currently-unreliable
foundation — re-verify `order-creation.spec.ts` passes cleanly a couple of
times before resuming.

---

## Scene 5.2 — Amendment Configuration

**Domain:** subscription
**Status:** built, passing (`tests/contract-amendment.spec.ts`, 2026-10-01). The fixture needs Enterprise Tier = Advanced in the configurator so the licenses become their own lines; see CATALOG.md

**Re-tested on `opmsalescrm1`, 2026-09-30 — works exactly as described,
same root cause/fix as Scene 2.2.** On contract `CNTR0010087`'s root line
("Solana Revenue Enablement Platform," a bundle with 3 children), selected
its checkbox and clicked **Modify entire line**: the guided configurator
reopened with every current quantity pre-populated exactly as it existed
(Standard=1250, Partner=300, Viewer=100 — matching the live contract, not
reset to defaults), an **Effective Date (System)** field defaulting to
09/28/2026, and a "No Items in Shopping Cart" starting state (this is a
modify, not a fresh add). Increased Standard User Licenses 1250→1500: the
cart immediately showed `previous Qty: 1250` / `current Qty: 1500` and
`previous Monthly: $65,000.00` / `current Monthly: $78,000.00` — the
struck-through-old-vs-new display FLOWS.md describes, confirmed directly in
the DOM (`gridcell "previous Qty 1250 current Qty 1500"`), not just visually
inferred. Clicking **Save and Close** created a new Order (`ORD0001217`,
`order_type: "Change"`) rather than mutating the contract in place — did
not separately alter the Effective Date field (calendar-picker interaction
was fiddly; the default date was accepted as-is), so the "future effective
date" half of this scene's description is unconfirmed but the core
mechanism (reopen → pre-populated → edit → Save and Close → new Order) is
fully verified. The ramp-recompute assertion is untested here (this
fixture's line wasn't on a ramp) — worth a dedicated pass once/if a ramped
line exists on a contract. See TESTING-STRATEGY.md §3.

Persona: Asher Sky (AE). Click **Modify entire line** to reopen the guided
configurator — assert every current contract line/quantity is pre-populated
exactly as it exists today (not reset to defaults). Set an *Effective Date*
for the change (a future date, not today), then increase one or more
license quantities. Assert:
- The cart updates immediately showing old values struck through next to
  the new values.
- If the changed line was on a ramp (Scene 2.3), the remaining/future ramp
  segments recompute to reach the *new* ceiling quantity by contract end —
  assert the ramp's final segment quantity equals the new target, and that
  the schedule still lands within the original contract end date. Don't
  assert the exact intermediate segment values the source doc observed
  (100 → 300 → 400 → 500) since the interpolation logic wasn't independently
  verified there — only the *end state* is a safe assertion.
- **Save and Close** creates a new (amendment) Order for this change, rather
  than mutating the existing contract in place.

---

## Scene 5.3 — Amendment Order Review

**Domain:** subscription
**Status:** built, passing (`tests/contract-amendment.spec.ts`, 2026-10-01). The fixture needs Enterprise Tier = Advanced in the configurator so the licenses become their own lines; see CATALOG.md

**Re-tested on `opmsalescrm1`, 2026-09-30 — the change-type marker exists
exactly as described, on the field name `contract_line_type` (not
`action`, which also exists but carries different values — see below).**
Queried `ORD0001217`'s 11 line items directly: the 2 genuinely new lines
("Platinum Core", "SFDC Connector" — added fresh by the configurator, not
existing before) show `contract_line_type: "Amend"` and `action: "Add"`.
Lines whose quantity the amendment actually changed (Standard User License
1250→1500, the root "Solana Revenue Enablement Platform") show
`contract_line_type: "Amend"` too. Lines that existed before AND whose own
quantity did NOT change (two "Partner User License" segments, "Viewer
License", one "SFDC Connector") show `contract_line_type: "No change"` —
this is the field that carries FLOWS.md's exact "No change"/"Amend"
distinction. The separate `action` field instead reads "Add" for the 2 new
lines and "Change" for every pre-existing line regardless of whether that
line's own quantity moved — don't use `action` for this assertion, use
`contract_line_type`. No ramped line was involved in this fixture, so the
ramp-schedule-reflects-effective-date half is unconfirmed. See
TESTING-STRATEGY.md §3.

Persona: Order Operations. Open the new amendment Order (Draft) and its
**Line Items** tab. Assert each line item carries an explicit change-type
marker distinguishing what actually changed: lines with no quantity/config
change show something like "No change", while lines the amendment touched
show "Amend" — and an entirely new license tier being added for the first
time shows as its own new line (e.g. "Add"/"Amend"), not a modification of
an existing line. If a ramped line was amended, open its ramp reference and
assert the updated schedule and new contract dates reflect the amendment's
effective date, not the original contract dates.

---

## Scene 5.4 — Amendment Order Submission

**Domain:** subscription
**Status:** built, passing (`tests/contract-amendment.spec.ts`, 2026-10-01). The fixture needs Enterprise Tier = Advanced in the configurator so the licenses become their own lines; see CATALOG.md

**Re-tested on `opmsalescrm1`, 2026-09-30 — the submission mechanic matches
exactly; the pricing-scope claim does NOT hold on this instance.** Same
Review & Submit → "Confirmation" dialog → Submit sequence as Scene 3.3,
confirmed identical on the amendment order: Order State → `Submitted`.
**Divergence from FLOWS.md:** the review screen itemizes ALL 11 lines on
the order (not just the 2 changed/added ones), and "Total amount" reads
$4,106,016.00 — the account's full cumulative contract value, matching the
same total shown on the contract line grid in Scene 5.2 — not a total
scoped down to only what changed. Assert the full-order-total behavior
here, not FLOWS.md's "only the changed/added lines" claim. See
TESTING-STRATEGY.md §3.

Persona: Order Operations. Same **Review & Submit** → confirm → Submit
sequence as Scene 3.3, but on the amendment order. Assert Order State →
"Submitted" and that the review screen's itemized total reflects only the
changed/added lines' pricing (not the account's full contract value).

---

## Scene 5.5 — Amendment Order Task Fulfillment

**Domain:** subscription
**Status:** built, passing (`tests/contract-amendment.spec.ts`, 2026-10-01). The fixture needs Enterprise Tier = Advanced in the configurator so the licenses become their own lines; see CATALOG.md

**Re-tested on `opmsalescrm1`, 2026-09-30 — confirms both the mechanic and
the "fewer/different tasks" regression guard.** The amendment order
generated exactly **2** tasks ("Validate customer entitlement", "Validate
license availability", both `request_type: "Top Order Line Item"`, both
scoped to the top/root line `ORDL0001425`) — genuinely different task
names from a fresh order's tasks (Scene 3.3 found "Complete customer
account validation"/"Compelete address validation" for a brand-new order),
and scoped to a single line rather than all 11. Same task-close → Approve
pattern as Scene 3.4 confirmed identical: closing both tasks flips Order
State → `New`, clicking Approve → `Acknowledged`, no dialog. See
TESTING-STRATEGY.md §3.

Persona: Order Operations. Same task-close → Approve pattern as Scene 3.4,
but assert the amendment generates **fewer** tasks than the original order
did (only tied to the lines the amendment actually touched, not the full
line set) — a good regression guard that task generation scopes correctly
to what changed rather than re-validating the whole order every time.

---

## Scene 5.6 — Amendment Order Completion

**Domain:** subscription
**Status:** built, passing (`tests/contract-amendment.spec.ts`, 2026-10-01). The fixture needs Enterprise Tier = Advanced in the configurator so the licenses become their own lines; see CATALOG.md

**Re-tested on `opmsalescrm1`, 2026-09-30 — matches exactly.** Completed
all 11 order lines (via direct State update, same "no bulk-select, set the
line's own State + Save" mechanic Scene 3.5 already documented) and the
Order rolled up to State → `Completed`, matching FLOWS.md. This did
trigger the contract update verified in Scene 5.7 below. See
TESTING-STRATEGY.md §3.

Persona: Order Operations. Same line-completion pattern as Scene 3.5.
Assert Order State → "Completed" once every changed/added line is
Completed, and that this is what triggers the contract update verified next
in Scene 5.7.

---

## Scene 5.7 — Amended Contract Verification

**Domain:** subscription
**Status:** built, passing (`tests/contract-amendment.spec.ts`, 2026-10-01). The fixture needs Enterprise Tier = Advanced in the configurator so the licenses become their own lines; see CATALOG.md

**Re-tested on `opmsalescrm1`, 2026-09-30 — confirms the core claim
directly.** Queried the contract line for "Standard User License –
Advanced" after the amendment order completed: its `quantity` field reads
**1,500** — the amended value, not the original 1,250 — with no manual
edit. Two new contract lines also appeared ("SFDC Connector", "Platinum
Core") matching the 2 "Add" lines from the amendment order. This closes
the loop end-to-end: configurator change → order → fulfillment → contract
update, with the *contract* (not just the order) as final source of truth,
exactly as FLOWS.md describes. Did not separately verify the
"segment window ends exactly where the effective date cut it off" half
(no ramp was involved in this fixture, and the Effective Date field wasn't
changed from its default in Scene 5.2's run) — worth a dedicated check
once a ramped/future-dated amendment is tested. See TESTING-STRATEGY.md §3.

Persona: Asher Sky (AE). Back on the account's Contract → **Customer
Contract Lines**. Assert the contract itself now reflects the amendment
without anyone having hand-edited it directly: the amended line's active
segment window ends exactly where the effective date cut it off, and any
newly-added license line appears as its own contract line with the
amendment's effective date as its start. This closes the loop:
configurator change → order → fulfillment → contract update — the end-to-end
assertion worth encoding is that the *contract* (not just the order) is the
final source of truth reflecting the change.

---

## Scene 5.8 — Renewal

**Domain:** subscription
**Status:** built, passing on `opmsalescrmgd` (Gold-only) · broken on `opmsalescrm1` (`tests/contract-renewal.spec.ts`)

Persona: Asher Sky (AE). On the account's Contract → **Customer Contract
Lines**, select the root line's checkbox, but click **Renew** instead of
Modify Entire Line this time. In the **Renew customer contract line?**
dialog, *Contract line expires by* and *Renew from* (the day after
expiration) auto-populate. Assert:
- Changing *Renew from* to an earlier date is the *entire* mechanism for an
  early renewal — there is no separate "early renewal" flow/button; a good
  test is explicitly renewing early via this same dialog rather than only
  testing the at-expiration path.
- Clicking **Renew** creates a new Opportunity and Quote (visible on the
  contract's Renewal Opportunities / Renewal Quotes tabs) rather than
  extending the existing contract line in place — the dialog itself warns
  the selected line "will be terminated early to create a renewed contract",
  which is worth asserting literally holds (i.e. the original line's state/
  end date changes to reflect early termination, not just that a new
  opportunity appeared).
- The renewal Quote should carry forward the Renewal Adjustment Basis/Type/
  Value set back in Scene 2.1 as its starting terms — a good cross-scene
  regression check once both specs exist, tying Scene 2.1's setup to this
  scene's output.
- From here the renewal quote re-enters the ordinary CPQ flow (Scenes
  2.1–2.6 mechanics apply) — this scene's own scope ends at "opportunity +
  quote were created correctly", not re-testing the full CPQ path again.

**Investigated on `opmsalescrm1` — genuinely blocked, not a spec-writing gap.**
The dialog mechanics described above are all real and correct: selecting the
root line's checkbox correctly gates Renew (disabled → enabled, same pattern
as Scene 5.1); a non-sellable line is correctly refused with an explicit "The
selected line is not sellable and won't be renewed" notice (a sellable
product must be used — many catalog products on this instance are
`sellable=false`, e.g. "Micro Apps"); Contract line expires by / Renew from
auto-populate exactly as described, and Renew from is freely editable to an
earlier date. But clicking **Renew** itself throws a Critical
"Unable to create an order/quote/opportunity. Contact your system
administrator." alert every time, reproduced identically both with an
early-renewal date and with the untouched default date. It's a genuine
partial server-side failure, not a no-op: a new Quote **is** created in
Draft state, but never correctly linked back (`source_opportunity` and
`existing_contract` both stay blank, `auto_generated_for_renewal` stays
`false`) — and no Opportunity is created at all. Re-opening the dialog a
second time surfaces "There are already renewal opportunities or quotes for
this contract. Reviewing them is recommended before continuing," confirming
the orphaned partial artifact. There is no API-level workaround since this
is a UI-only mechanism (same class of limitation as Scene 5.2's blocked
guided-configurator path) — this needs a platform/admin fix on
`opmsalescrm1`. See TESTING-STRATEGY.md §3.

**Re-tested on `opmsalescrmgd` (Gold) — confirms the root cause above, and
Renewal genuinely works.** Same precondition, same dialog, same two
reproductions (default date, early date): clicking Renew succeeds cleanly
both times with no Critical error — a real, properly-linked Opportunity and
Quote get created (`source_opportunity` populated, product line carried
over), exactly matching this scene's description. 3 consecutive clean runs
in `tests/contract-renewal.spec.ts`. This confirms the `opmsalescrm1`
failure is specifically the broken CPQ-Logik.io tenant connection, not a
separate universal defect — once that connection is fixed on `opmsalescrm1`,
this same spec should be re-run there too (it targets Gold via
`E2E_ENV_FILE=.env.opmsalescrmgd` and is not expected to pass on
`opmsalescrm1` as-is). One claim from the description above was **not**
confirmed: the *original* line's own state/end date did not visibly change
to reflect early termination within the observed window on Gold — left
unasserted in the spec rather than treated as verified. The Renewal
Adjustment Basis/Type/Value carry-forward from Scene 2.1 and the "re-enters
ordinary CPQ flow" claim were not independently checked — out of scope for
this pass.

**Re-tested on `opmsalescrm1`, 2026-09-30 — STILL FAILS, disproving the
"same root cause as 2.2" hypothesis.** The CPQ-Logik.io tenant
misconfiguration that blocked Scenes 2.2/2.3/5.2–5.7 is now fixed (confirmed
— all 6 of those scenes retested and working end-to-end today). Renewal was
re-tested on the same premise ("this should now work too") — it does not.
Selecting the root line's checkbox and clicking Renew on `CNTR0010087`
(same contract used to verify 5.2–5.7) reproduces the **exact same**
Critical "Unable to create an order/quote/opportunity. Contact your system
administrator." error as the original 2026-09-22 investigation. One
difference from that original run: this time **no orphaned Quote was
created at all** (queried immediately after — no new
`sn_quote_mgmt_core_quote` record appeared), whereas the original run left
behind a Draft quote with blank `source_opportunity`/`existing_contract`.
**Conclusion: Renewal has its own distinct root cause, separate from the
CPQ-Logik.io tenant issue** — still genuinely blocked on `opmsalescrm1`,
needs its own platform/admin investigation (not assumed to piggyback on any
other fix). Keep using `opmsalescrmgd` for this scene until that's found.

**Re-tested on `opmsalescrm1`, 2026-10-01 — now PASSES.** `tests/contract-renewal.spec.ts`
ran 3/3 clean against `opmsalescrm1` with no spec change: Renew creates a linked Opportunity
and Quote with the product line carried over, and the fixture tears down cleanly. The cause of
the 09-22/09-30 failure was never identified — something changed instance-side in between. If
the Critical error comes back, treat it as that same unresolved issue.

---

## Sales Forecasting rollup math

**Domain:** forecasting
**Status:** built, passing (`tests/sales-forecasting-rollup.spec.ts`)

The Sales Forecasting app (`sn_sales_forecast_header`/`item`/
`associated_opportunity`) computes Individual (opportunity-level) and Rollup
(hierarchy-level) forecasts. Two verified fixtures to turn into assertions:

**Case 1 — Individual forecast rollup from opportunities**
Header: "New York (Riley Cole_AMS_WEST_OR_WA_TECH_L5)", period 2026 Q3,
item_type=Individual, sys_id `017fa9c92b134b504deaf02ac891bf48`.
Underlying opportunities: OPTY0001039 (Rose City Software, stage=Validation,
amount=$175,000) and OPTY0001040 (Cascadia Cyber Systems, stage=Negotiation,
amount=$230,000).
Expected forecast category totals for 2026 Q3: Commit=$230,000 (only
OPTY0001040, since it's in Negotiation), Pipeline/Upside/Strong Upside=
$405,000 (both opportunities).
Test: open the forecast header, expand Forecast Items, assert these 4
category amounts. Optionally also assert the Forecast Source Record /
Associated Opportunity related list on the Commit item shows only
OPTY0001040, and on the Pipeline item shows both.

**Case 2 — Rollup (hierarchy) forecast aggregation**
Top header: "AMS (Cameron Patel_TECH_L2)" Rollup, period 2026 Q3, sys_id
`457fa9c92b134b504deaf02ac891bf4a`. It aggregates 3 children (all period
2026 Q3):
- Avery Chen "AMS" Individual (her own personal deals) sys_id
  `457fa9c92b134b504deaf02ac891bf48` — $58,000 in every category
  (Pipeline/Upside/Strong Upside/Commit/Won)
- Avery Chen "AMS-East" Rollup sys_id `897fa9c92b134b504deaf02ac891bf52` —
  Pipeline/Upside/Strong Upside=$1,345,000, Commit=$960,000, no Won line
  (=$0)
- Taylor Morgan "AMS-West" Rollup sys_id `cd7fa9c92b134b504deaf02ac891bf52`
  — $305,000 in every category

Expected totals on Cameron's top header: Pipeline/Upside/Strong
Upside=$1,708,000, Commit=$1,323,000, Won=$363,000 (sum of the three
children per category).
Test: assert the top-level header's Forecast Items amounts equal the sum of
all 3 children's amounts per category. Gotcha to encode as a regression
guard: don't just sum the two obvious sub-team rollups (AMS-East +
AMS-West) — that's short by exactly $58,000 unless the manager's own
Individual header (Avery Chen's personal "AMS" record) is also included.
Assert that omission explicitly (e.g. AMS-East + AMS-West alone ≠ the
rollup total) so a future change can't silently drop that branch again.

Instance these fixtures were originally verified on: `empksingampalli`.

**Re-verified on `opmsalescrm1`, 2026-09-22 — contrary to the expectation
above, sys_ids and amounts turned out to match EXACTLY.** `opmsalescrm1`
shares the identical underlying Sales Forecasting seed data as
`empksingampalli` — every sys_id and every dollar figure in both cases above
(including the regression guard) reproduced precisely with no changes
needed. The spec is a pure read-only data check (`snQuery` against
`sn_sales_forecast_item`, no UI interaction, no fixtures created or torn
down, since these are real non-disposable demo records). See
TESTING-STRATEGY.md §3 for the one real wrinkle found: forecast items exist
at week/month/quarter granularity simultaneously for the same header, and
only the quarter-period row per category holds the authoritative total —
naively summing every item overcounts substantially.

**Data reseeded on `opmsalescrm1` 2026-09-28 — spec broke on sys_id 404s,
re-verified and fixed 2026-09-30.** The full Sales Forecasting dataset was
regenerated with new sys_ids (old header `017fa9c9...bf48` etc. now 404;
~3,396 fresh forecast items exist instead). The underlying
territory/hierarchy structure and every dollar amount are byte-identical to
before — only sys_ids and the owning person's name changed (e.g. "Riley
Cole" now owns the New York Individual header instead of being tied to a
different name previously; "Avery Chen" still owns the AMS rollup chain).
Re-derived the new sys_ids directly from the live instance (matched by
territory + verifying the actual Q3 2026 dollar totals against the spec's
expected values) and updated the spec — both cases pass again with no
assertion changes needed, confirming this was pure sys_id drift from a
reseed, not a real regression. If this happens again: query
`sn_sales_forecast_header` for `item_type=Individual`/`Rollup` and match by
the `territory` field (stable) rather than by owner name (rotates), then
confirm via `sn_sales_forecast_item` that the Q3-period dollar totals match
before trusting a candidate header.

---

## Module 6 — PRM (Partner-led quoting)

**Domain:** prm
**Status:** not built in golden demo — nothing to test yet

Per the clickpath doc: a Channel Partner registers a deal and builds a
partner-priced quote (personas: a Channel Partner, an Enterprise
Relationship Manager, a Partner Manager). Marked "Planned" in the source
doc — confirm whether it's been built on the target instance before adding
a real entry here.

---

<!--
Template for a new entry:

## <Flow name>

**Domain:** <optional>
**Status:** not yet written

<Plain description of what the flow does and what "correct" looks like.
Include specific record numbers/sys_ids/amounts if you have them —
they become the actual assertions.>
-->
