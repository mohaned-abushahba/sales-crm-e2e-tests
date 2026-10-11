import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as dotenv from 'dotenv';
import { loadCapturedRecords, truncate } from './drift';

// Built once at the end of the run (Playwright globalTeardown) from results/drift-findings.jsonl,
// because failed tests restart the worker and per-worker hooks would each see a partial picture.
export default function buildDriftReport() {
  dotenv.config({ path: `./${process.env.E2E_ENV_FILE ?? '.env'}`, override: true });
  const file = resolve('results/drift-findings.jsonl');
  if (!existsSync(file)) return;
  const all = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as any);
  const setsDir = process.env.UPDATE_SETS_DIR ?? '../sales-crm-golden-demo/update-sets';
  const { records, skipped } = existsSync(resolve(setsDir)) ? loadCapturedRecords(resolve(setsDir)) : { records: [], skipped: [] };
  const targetUrl = (process.env.SERVICENOW_INSTANCE_URL ?? '').replace(/\/$/, '');
  const SOURCE_ENV_FILE = process.env.SOURCE_ENV_FILE ?? '.env';
  const host = targetUrl.replace(/^https?:\/\//, '').split('.')[0] || 'target';
  const day = new Date().toISOString().slice(0, 10);
  const dir = resolve('drift-reports');
  mkdirSync(dir, { recursive: true });

  const by = (k: string) => all.filter((f: any) => f.kind === k);
  const lines: string[] = [
    `# Config drift — ${host} (${day})`,
    '',
    `Update sets checked: ${new Set(records.map((r) => r.updateSet)).size} · records: ${records.length} · not checkable: ${skipped.length}`,
    `Source instance for layer 2: ${SOURCE_ENV_FILE}`,
    '',
    '| Finding | Count |',
    '|---|---|',
    ...(['missing-on-target', 'field-mismatch', 'changed-after-capture', 'uncaptured-missing-on-target', 'unreadable-table'] as const).map(
      (k) => `| ${k} | ${by(k).length} |`
    ),
    '',
  ];
  for (const kind of ['missing-on-target', 'field-mismatch', 'changed-after-capture', 'uncaptured-missing-on-target'] as const) {
    const list = by(kind);
    if (!list.length) continue;
    lines.push(`## ${kind}`, '');
    for (const f of list) {
      lines.push(`- \`${f.table}\` ${f.sysId} — ${truncate(f.label ?? '', 80)}${f.updateSet ? ` (${f.updateSet})` : ''}${f.detail ? ` — ${f.detail}` : ''}`);
      for (const d of f.diffs ?? []) lines.push(`  - \`${d.field}\`: captured \`${truncate(d.captured, 80)}\` vs target \`${truncate(d.actual, 80)}\``);
    }
    lines.push('');
  }
  if (by('unreadable-table').length) {
    lines.push('## unreadable-table (Table API refused; not verified)', '');
    for (const f of by('unreadable-table')) lines.push(`- \`${f.table}\` ${f.updateSet ?? ''} ${f.detail ?? ''}`);
    lines.push('');
  }
  if (skipped.length) lines.push('## not checkable (no sys_id in payload)', '', ...skipped.map((s: string) => `- ${s}`), '');
  writeFileSync(resolve(dir, `drift-${host}-${day}.md`), lines.join('\n'));
  writeFileSync(resolve(dir, `drift-${host}-${day}.json`), JSON.stringify(all, null, 2));
}
