import * as dotenv from 'dotenv';

dotenv.config({ path: `./${process.env.E2E_ENV_FILE ?? '.env'}`, override: true });

const baseURL = (process.env.SERVICENOW_INSTANCE_URL ?? '').replace(/\/$/, '');
const username = process.env.SERVICENOW_USERNAME ?? '';
const password = process.env.SERVICENOW_PASSWORD ?? '';

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

export async function snInsert(table: string, data: Record<string, string>): Promise<string> {
  const res = await fetch(`${baseURL}/api/now/table/${table}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Insert into ${table} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { result: { sys_id: string } };
  return body.result.sys_id;
}

export async function snGet(
  table: string,
  sysId: string,
  fields?: string,
  displayValue: 'true' | 'false' | 'all' = 'true'
): Promise<Record<string, any>> {
  const params = new URLSearchParams({
    sysparm_display_value: displayValue,
    sysparm_exclude_reference_link: 'true',
  });
  if (fields) params.set('sysparm_fields', fields);
  const res = await fetch(`${baseURL}/api/now/table/${table}/${sysId}?${params}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Get ${table}/${sysId} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { result: Record<string, any> };
  return body.result;
}

export async function snQuery(
  table: string,
  query: string,
  fields?: string,
  displayValue: 'true' | 'false' | 'all' = 'true'
): Promise<Record<string, any>[]> {
  const params = new URLSearchParams({
    sysparm_query: query,
    sysparm_display_value: displayValue,
    sysparm_exclude_reference_link: 'true',
  });
  if (fields) params.set('sysparm_fields', fields);
  const res = await fetch(`${baseURL}/api/now/table/${table}?${params}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Query ${table} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { result: Record<string, any>[] };
  return body.result;
}

export async function snUpdate(
  table: string,
  sysId: string,
  data: Record<string, string>
): Promise<void> {
  const res = await fetch(`${baseURL}/api/now/table/${table}/${sysId}`, {
    method: 'PATCH',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Update ${table}/${sysId} failed: ${res.status} ${await res.text()}`);
  }
}

export async function snDelete(table: string, sysId: string): Promise<void> {
  const res = await fetch(`${baseURL}/api/now/table/${table}/${sysId}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete ${table}/${sysId} failed: ${res.status} ${await res.text()}`);
  }
}
