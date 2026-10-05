# Sales CRM E2E Tests

Playwright end-to-end suite for the ServiceNow Sales CRM golden demo — lead to opportunity,
CPQ (quote, configuration, ramps, discounts, approvals, documents), order management,
contracts, amendment, renewal, and sales forecasting rollups.

## Setup

```sh
npm install
npx playwright install chromium
cp .env.example .env   # fill in instance URL and credentials
```

## Run

```sh
npm run test:e2e                         # full suite against the instance in .env
npx playwright test tests/ramps.spec.ts  # one spec
npm run test:e2e:headed                  # watch it in a browser
npm run report                           # open the last HTML report
```

To target another instance, create `.env.<name>` and run with
`E2E_ENV_FILE=.env.<name> npm run test:e2e`.

The suite runs serially (`workers: 1`). Most specs create their own fixture records through
the Table API and delete them afterwards; the forecasting spec is read-only against existing
demo data.

## Docs

- `CATALOG.md` — every flow, its spec, status, and last verified date. Check here first.
- `FLOWS.md` — what each demo scene does and what "correct" looks like, with findings per instance.
- `TESTING-STRATEGY.md` — conventions, locator patterns, and instance quirks.
