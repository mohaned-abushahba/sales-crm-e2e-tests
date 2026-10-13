import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CapturedRecord {
  updateSet: string; // file name, e.g. UPDATE-007-quote-defaulting-automation.xml
  table: string;
  sysId: string;
  label: string; // update name, e.g. sys_script_0a73...
  action: string;
  fields: Record<string, string>;
}

// Audit/bookkeeping fields that always differ between instances and say nothing about config.
const IGNORED_FIELDS = new Set([
  'sys_created_on',
  'sys_created_by',
  'sys_updated_on',
  'sys_updated_by',
  'sys_mod_count',
  'sys_package',
  'sys_update_name',
  'sys_scope',
  'sys_policy',
  'sys_domain',
  'sys_domain_path',
  'sys_class_name',
  'sys_customer_update',
]);

const CDATA_SPLIT = ']]]]><![CDATA[>';

/** Pull the text between <tag> and </tag>, honouring a CDATA wrapper (incl. split-escaped `]]>`). */
export function unwrap(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('<![CDATA[') && t.endsWith(']]>')) return t.slice(9, -3).split(CDATA_SPLIT).join(']]>');
  return t;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Parse the top-level child elements of a record_update payload into field -> value. */
export function parsePayloadFields(payload: string): { table: string; fields: Record<string, string> } | null {
  const head = payload.match(/<record_update[^>]*>\s*<([A-Za-z0-9_]+)[^>]*?(\/>|>)/);
  if (!head) return null;
  const table = head[1]!;
  let start = (head.index ?? 0) + head[0].length;
  // Natural-key tables (sys_documentation, sys_dictionary, ...) wrap the record in a second
  // element of the same name; step into it.
  const nested = payload.slice(start).match(new RegExp(`^\\s*<${table}(\\s[^>]*)?>`));
  if (nested) start += nested[0].length;
  const fields: Record<string, string> = {};
  let i = start;
  while (i < payload.length) {
    const open = payload.indexOf('<', i);
    if (open < 0) break;
    if (payload.startsWith(`</${table}>`, open)) break;
    const m = payload.slice(open).match(/^<([A-Za-z0-9_]+)((?:\s[^>]*?)?)(\/?)>/);
    if (!m) break;
    const name = m[1]!;
    const bodyStart = open + m[0].length;
    if (m[3] === '/') {
      fields[name] = '';
      i = bodyStart;
      continue;
    }
    let value: string;
    let end: number;
    if (payload.startsWith('<![CDATA[', bodyStart)) {
      // Value is one or more CDATA sections followed by the close tag.
      const close = payload.indexOf(`</${name}>`, bodyStart);
      let cursor = bodyStart;
      let acc = '';
      while (cursor < close) {
        if (payload.startsWith('<![CDATA[', cursor)) {
          const e = payload.indexOf(']]>', cursor + 9);
          acc += payload.slice(cursor + 9, e);
          cursor = e + 3;
        } else {
          acc += payload.slice(cursor, close);
          break;
        }
      }
      value = acc;
      end = close + name.length + 3;
    } else {
      const close = payload.indexOf(`</${name}>`, bodyStart);
      value = decodeEntities(payload.slice(bodyStart, close));
      end = close + name.length + 3;
    }
    fields[name] = value;
    i = end;
  }
  return { table, fields };
}

export function loadCapturedRecords(updateSetsDir: string): { records: CapturedRecord[]; skipped: string[] } {
  const out: CapturedRecord[] = [];
  const skipped: string[] = [];
  const files = readdirSync(updateSetsDir)
    .filter((f) => /^UPDATE-.*\.xml$/.test(f))
    .sort();
  for (const file of files) {
    const xml = readFileSync(join(updateSetsDir, file), 'utf8');
    for (const block of xml.match(/<sys_update_xml[\s\S]*?<\/sys_update_xml>/g) ?? []) {
      const action = block.match(/<action>(.*?)<\/action>/)?.[1] ?? '';
      const label = block.match(/<name>(.*?)<\/name>/)?.[1] ?? '';
      const payloadRaw = block.match(/<payload>([\s\S]*?)<\/payload>/)?.[1];
      if (!payloadRaw) continue;
      const parsed = parsePayloadFields(unwrap(payloadRaw));
      if (!parsed) continue;
      // sys_ui_form_sections is a grouping wrapper keyed by form id, not a table: its rows are
      // sys_ui_form_section records with no sys_id of their own, so it can't be checked per record.
      if (parsed.table === 'sys_ui_form_sections') {
        skipped.push(`${file}: ${label}`);
        continue;
      }
      const sysId = parsed.fields['sys_id'] ?? label.match(/([0-9a-f]{32})$/)?.[1];
      if (!sysId) {
        skipped.push(`${file}: ${label}`);
        continue;
      }
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.fields)) if (!IGNORED_FIELDS.has(k)) fields[k] = v;
      out.push({ updateSet: file, table: parsed.table, sysId, label, action, fields });
    }
  }
  // Later update sets supersede earlier ones for the same record (e.g. UPDATE-022 re-captures the
  // portal logo from UPDATE-003); only the last capture says what the instance should look like.
  const latest = new Map<string, CapturedRecord>();
  for (const r of out) latest.set(`${r.table}:${r.sysId}`, r);
  return { records: [...latest.values()], skipped };
}

function norm(v: unknown): string {
  let s = v == null ? '' : typeof v === 'object' ? String((v as any).value ?? '') : String((v as any));
  // Condition fields are exported with a trailing <item .../> expansion after "^EQ"; the Table
  // API returns only the encoded query, so compare the part before it.
  const itemAt = s.indexOf('<item ');
  if (itemAt >= 0) s = s.slice(0, itemAt);
  s = s.replace(/&#13;/g, '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  if (s === 'true') s = '1';
  else if (s === 'false') s = '0';
  if (/^-?\d+(\.\d+)?$/.test(s)) s = String(Number(s));
  return s;
}

export interface FieldDiff {
  field: string;
  captured: string;
  actual: string;
}

export function diffFields(captured: Record<string, string>, actual: Record<string, any>): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const [field, want] of Object.entries(captured)) {
    if (field === 'sys_id') continue;
    if (!(field in actual)) continue; // not exposed by the Table API on this table
    const a = norm(actual[field]);
    const w = norm(want);
    if (a !== w) diffs.push({ field, captured: w, actual: a });
  }
  return diffs;
}

export function truncate(s: string, n = 120): string {
  const one = s.replace(/\s+/g, ' ');
  return one.length > n ? `${one.slice(0, n)}…(${s.length} chars)` : one;
}

/**
 * Differences that are known not to be drift. Each one was checked against both instances.
 * - OOB reference fields point at a record whose sys_id is generated per instance (same name and
 *   label on both), so the captured sys_id can never match.
 * - sys_dictionary.attributes: stage adds edge_encryption_enabled=true on top of the captured value.
 * - sys_hub_flow.version_record: points at a flow version row that is per instance.
 */
export function isKnownBenign(table: string, d: FieldDiff): boolean {
  const key = `${table}.${d.field}`;
  if (
    key === 'sn_decision_table_decision_condition.reference' ||
    key === 'sys_db_object.super_class' ||
    key === 'sys_hub_flow.version_record' ||
    key === 'sys_granular_delegate.delegate_notified' // runtime flag flipped when the delegate is notified
  ) {
    return true;
  }
  if (key === 'sys_dictionary.attributes') {
    const rest = d.actual
      .split(',')
      .filter((a) => a !== 'edge_encryption_enabled=true' && a !== 'encode_utf8=false')
      .join(',');
    const want = d.captured.split(',').filter((a) => a !== 'encode_utf8=false').join(',');
    return rest === want;
  }
  return false;
}
