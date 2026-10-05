import { test, expect } from '@playwright/test';
import { snQuery } from '../utils/servicenow-api';

// This is a read-only data-integrity check against real (non-disposable) Sales Forecasting
// demo records on opmsalescrm1 — no fixtures are created or torn down.
//
// The demo forecast data gets reseeded (2026-09-28, again 2026-10-01), which changes sys_ids,
// moves headers to the current quarter, and changes dollar amounts. So nothing here is
// hardcoded: headers are looked up by name for the quarter containing today, and expected
// totals are derived from the live opportunities / child forecasts rather than literals.
// See TESTING-STRATEGY.md §3 for the week/month/quarter granularity note (only the item whose
// `period` = the header's own quarter holds the real total).

const ROLLUP_CATEGORIES = ['Pipeline', 'Upside', 'Strong Upside', 'Commit'];

// Forecast headers exist for more than one quarter under the same name (next quarter's are
// pre-created empty) — pick the one whose period contains today.
async function currentHeader(name: string) {
  const headers = await snQuery(
    'sn_sales_forecast_header',
    `name=${name}`,
    'sys_id,owner,territory,period,period.start,period.end',
    'false'
  );
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const header = headers.find((h) => h['period.start'] <= now && now < h['period.end']);
  expect(header, `no current-quarter forecast header named "${name}"`).toBeDefined();
  return header!;
}

async function quarterCategoryTotals(header: Record<string, any>): Promise<Record<string, number>> {
  const items = await snQuery(
    'sn_sales_forecast_item',
    `forecast_header=${header.sys_id}^period=${header.period}`,
    'forecast_category,hierarchy_forecast'
  );
  const totals: Record<string, number> = {};
  for (const item of items) {
    totals[item.forecast_category] = parseFloat(String(item.hierarchy_forecast).replace(/,/g, ''));
  }
  return totals;
}

test.describe('Sales Forecasting rollup math', () => {
  test('Case 1: an Individual forecast rolls up open opportunities cumulatively by forecast category', async () => {
    const header = await currentHeader('Riley Cole_AMS_WEST_OR_WA_TECH_L5');
    const totals = await quarterCategoryTotals(header);

    // Open opportunities for this rep/territory closing inside the header's quarter.
    const opportunities = await snQuery(
      'sn_opty_mgmt_core_opportunity',
      `assigned_to=${header.owner}^territory=${header.territory}` +
        `^estimated_closed_date>=${header['period.start']}^estimated_closed_date<${header['period.end']}`,
      'number,amount,forecast_category.name,forecast_category.order',
      'false'
    );
    const open = opportunities.filter((o) => ROLLUP_CATEGORIES.includes(o['forecast_category.name']));
    expect(open.length).toBeGreaterThan(0);

    // Categories are cumulative by their `order` (Pipeline 100 < Upside 200 < Strong Upside 300
    // < Commit 400): each bucket counts every open opportunity at or above it, so a Commit deal
    // also counts toward Strong Upside, Upside and Pipeline.
    const categories = await snQuery('sn_sales_forecast_category', `nameIN${ROLLUP_CATEGORIES.join(',')}`, 'name,order', 'false');
    const categoryOrder = Object.fromEntries(categories.map((c) => [c.name, Number(c.order)]));

    for (const category of ROLLUP_CATEGORIES) {
      const expected = open
        .filter((o) => Number(o['forecast_category.order']) >= categoryOrder[category])
        .reduce((sum, o) => sum + parseFloat(o.amount), 0);
      expect(totals[category] ?? 0, category).toBe(expected);
    }
    // Pipeline must actually exceed the narrower buckets for this check to mean anything.
    expect(totals['Pipeline']).toBeGreaterThan(totals['Commit'] ?? 0);
  });

  test('Case 2: a Rollup forecast equals the sum of its child forecasts in every category', async () => {
    // Territory hierarchy: AMS → AMS-East + AMS-West; AMS-West → California + Oregon-Washington.
    const hierarchy: Record<string, string[]> = {
      'AMS (Avery Chen_AMS_TECH_L3)': [
        'AMS-East (Sophia Bennett_AMS_EAST_TECH_L4)',
        'AMS-West (Taylor Morgan_AMS_WEST_TECH_L4)',
      ],
      'AMS-West (Taylor Morgan_AMS_WEST_TECH_L4)': ['California', 'Oregon-Washington'],
    };

    for (const [parentName, childNames] of Object.entries(hierarchy)) {
      const parent = await quarterCategoryTotals(await currentHeader(parentName));
      const children = [];
      for (const name of childNames) children.push(await quarterCategoryTotals(await currentHeader(name)));

      expect(parent['Pipeline'], `${parentName} has no Pipeline total`).toBeGreaterThan(0);
      for (const category of ROLLUP_CATEGORIES) {
        const childSum = children.reduce((sum, c) => sum + (c[category] ?? 0), 0);
        expect(parent[category] ?? 0, `${parentName} / ${category}`).toBe(childSum);
      }
      // Regression guard: every child contributes, so dropping any one branch undercounts.
      for (const [i, c] of children.entries()) {
        if ((c['Pipeline'] ?? 0) > 0) {
          const withoutChild = children.filter((_, j) => j !== i).reduce((s, x) => s + (x['Pipeline'] ?? 0), 0);
          expect(withoutChild, `omitting ${childNames[i]}`).toBeLessThan(parent['Pipeline']);
        }
      }
    }
  });
});
