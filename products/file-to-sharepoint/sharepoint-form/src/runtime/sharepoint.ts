import { validateDefinition, validateFormId, validateSubmission } from './definition';
import type { FormDefinition, SavedSubmission, Submission } from './definition';

export interface HttpResult { ok: boolean; status: number; json: () => Promise<unknown> }
export interface RequestOptions { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }
export type SharePointRequest = (url: string, options: RequestOptions) => Promise<HttpResult>;
export interface AdapterOptions { webUrl: string; definitionListId: string; responseListId: string; request: SharePointRequest }
interface ListItem { FormId?: string; DefinitionJson?: string; SubmissionId?: string; DefinitionVersion?: number; ResponseJson?: string }

/** Uses the caller's current-user SharePoint connection; never provisions lists or changes ACLs. */
export function createSharePointAdapter(options: AdapterOptions): {
  loadDefinition: (formId: string) => Promise<FormDefinition>;
  saveDefinition: (definition: FormDefinition) => Promise<void>;
  submit: (input: Submission) => Promise<SavedSubmission>;
} {
  const { webUrl, definitionListId, responseListId, request } = options;
  let parsed: URL;
  try { parsed = new URL(webUrl); } catch { throw new Error('Invalid SharePoint web URL'); }
  if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.sharepoint(?:\.com|\.us|\.cn|-mil\.us)$/i.test(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port || /(?:^|\/)\.{1,2}(?:\/|$)|%2e|%2f|%5c|\\/i.test(webUrl)) throw new Error('Invalid SharePoint web URL');
  for (const id of [definitionListId, responseListId]) if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('Invalid SharePoint list ID');
  const base = parsed.href.replace(/\/$/, '');
  const items = (list: string): string => `${base}/_api/web/lists(guid'${list}')/items`;
  const headers = { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata' };
  const get = async (url: string): Promise<ListItem[]> => {
    const response = await request(url, { method: 'GET', headers });
    if (!response.ok) throw new Error(`SharePoint read failed (${response.status}).`);
    const data = await response.json() as { value?: unknown };
    if (!data || !Array.isArray(data.value)) throw new Error('Invalid SharePoint list response');
    return data.value as ListItem[];
  };
  const find = (list: string, column: string, value: string): Promise<ListItem[]> => get(`${items(list)}?$filter=${encodeURIComponent(`${column} eq '${value}'`)}&$top=2`);
  const loadDefinition = async (formId: string): Promise<FormDefinition> => {
    validateFormId(formId);
    const found = await find(definitionListId, 'FormId', formId);
    if (found.length !== 1 || found[0].FormId !== formId || typeof found[0].DefinitionJson !== 'string') throw new Error('The form definition is unavailable or ambiguous.');
    const definition = validateDefinition(JSON.parse(found[0].DefinitionJson));
    if (definition.id !== formId) throw new Error('Invalid stored form ID');
    return definition;
  };
  const saveDefinition = async (input: FormDefinition): Promise<void> => {
    const definition = validateDefinition(input);
    const existing = await find(definitionListId, 'FormId', definition.id);
    if (existing.length) {
      if (existing.length !== 1 || existing[0].DefinitionJson !== JSON.stringify(definition)) throw new Error('A different form definition already uses this ID.');
      return;
    }
    const response = await request(items(definitionListId), { method: 'POST', headers, body: JSON.stringify({ Title: definition.title.slice(0, 255), FormId: definition.id, DefinitionJson: JSON.stringify(definition) }) });
    if (!response.ok) throw new Error(`SharePoint definition save failed (${response.status}). Check the existing form before retrying.`);
    const created = await response.json().catch(() => undefined) as { Id?: number } | undefined;
    if (created && Number.isInteger(created.Id) && created.Id! > 0) return;
    const confirmed = await loadDefinition(definition.id).catch(() => undefined);
    if (!confirmed || JSON.stringify(confirmed) !== JSON.stringify(definition)) throw new Error('Form definition save not confirmed. Check the existing form before explicitly retrying.');
  };
  const submit = async (input: Submission): Promise<SavedSubmission> => {
    const definition = await loadDefinition(input.formId);
    const payload = validateSubmission(definition, input);
    const acknowledgement: SavedSubmission = { status: 'saved', submissionId: payload.submissionId };
    const confirmExisting = async (): Promise<boolean> => {
      const found = await find(responseListId, 'SubmissionId', payload.submissionId);
      if (!found.length) return false;
      if (found.length !== 1 || found[0].SubmissionId !== payload.submissionId || found[0].FormId !== payload.formId || found[0].DefinitionVersion !== 1 || typeof found[0].ResponseJson !== 'string') throw new Error('Submission ID collision or invalid persisted response.');
      const stored = validateSubmission(definition, { ...payload, values: JSON.parse(found[0].ResponseJson) });
      if (JSON.stringify(stored.values) !== JSON.stringify(payload.values)) throw new Error('Submission ID already contains different values.');
      return true;
    };
    // A unique indexed SubmissionId column protects this read/insert against concurrent clients.
    if (await confirmExisting()) return acknowledgement;
    let response: HttpResult;
    try {
      response = await request(items(responseListId), { method: 'POST', headers, body: JSON.stringify({ Title: payload.submissionId, SubmissionId: payload.submissionId, FormId: payload.formId, DefinitionVersion: 1, ResponseJson: JSON.stringify(payload.values) }) });
    } catch {
      if (await confirmExisting().catch(() => false)) return acknowledgement;
      throw new Error('Response not confirmed. Values and submission ID must be retained; check before explicitly retrying.');
    }
    if (response.ok) {
      const created = await response.json().catch(() => undefined) as { Id?: number } | undefined;
      if (created && Number.isInteger(created.Id) && created.Id! > 0) return acknowledgement;
      if (await confirmExisting().catch(() => false)) return acknowledgement;
      throw new Error('Response not confirmed: SharePoint did not return a created item. Check the submission ID before explicitly retrying.');
    }
    if ([400, 401, 403, 404].indexOf(response.status) >= 0) throw new Error(`SharePoint response save failed (${response.status}).`);
    if (await confirmExisting().catch(() => false)) return acknowledgement;
    throw new Error(`Response not confirmed (${response.status}). Check the submission ID before explicitly retrying.`);
  };
  return { loadDefinition, saveDefinition, submit };
}
