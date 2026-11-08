export type FieldKind = 'text' | 'checkbox' | 'choice' | 'radio';
export interface FormField {
  id: string;
  sourceName: string;
  kind: FieldKind;
  label: string;
  value: string | boolean;
  choices?: { value: string; label: string }[];
  required: boolean;
  readOnly: boolean;
  multiline?: boolean;
  exportValue?: string;
  geometry?: { pageIndex: number; rect: { x: number; y: number; width: number; height: number } };
}
export interface FormDefinition { version: 1; id: string; title: string; fields: FormField[] }
export interface Submission { formId: string; definitionVersion: 1; submissionId: string; values: Record<string, string | boolean> }
export interface SavedSubmission { status: 'saved'; submissionId: string }

function invalid(message: string): never { throw new Error(`Invalid form: ${message}`); }
function record(value: unknown, keys: string[], context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(context);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(`${context} prototype`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => keys.indexOf(key) < 0)) invalid(`${context} contains unsupported properties`);
  return result;
}
function text(value: unknown, context: string, max: number = 32768): asserts value is string {
  if (typeof value !== 'string' || value.length > max) invalid(context);
}
export function validateFormId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('form ID');
}
export function validateDefinition(input: unknown): FormDefinition {
  const definition = record(input, ['version', 'id', 'title', 'fields'], 'definition');
  if (definition.version !== 1) invalid('definition version');
  validateFormId(definition.id);
  text(definition.title, 'title', 1024);
  if (!Array.isArray(definition.fields) || definition.fields.length < 1 || definition.fields.length > 500) invalid('fields (1–500 required)');
  const ids = new Set<string>();
  for (const inputField of definition.fields) {
    const field = record(inputField, ['id', 'sourceName', 'kind', 'label', 'value', 'choices', 'required', 'readOnly', 'multiline', 'exportValue', 'geometry'], 'field');
    if (typeof field.id !== 'string' || !/^f_[a-f0-9]{16}$/.test(field.id) || ids.has(field.id)) invalid('field ID or duplicate field ID');
    ids.add(field.id);
    text(field.sourceName, 'source name', 4096);
    text(field.label, 'field label', 4096);
    if (['text', 'checkbox', 'choice', 'radio'].indexOf(field.kind as string) < 0) invalid('field kind');
    if (typeof field.required !== 'boolean' || typeof field.readOnly !== 'boolean') invalid('field flags');
    if (field.kind === 'checkbox') {
      if (typeof field.value !== 'boolean') invalid('checkbox value');
    } else text(field.value, 'field value');
    if (field.multiline !== undefined && (typeof field.multiline !== 'boolean' || field.kind !== 'text')) invalid('multiline');
    if (field.exportValue !== undefined) { if (field.kind !== 'checkbox') invalid('export value'); text(field.exportValue, 'export value'); }
    if (field.kind === 'choice' || field.kind === 'radio') {
      if (!Array.isArray(field.choices) || !field.choices.length || field.choices.length > 500) invalid('choices');
      const options = new Set<string>();
      for (const inputChoice of field.choices) {
        const choice = record(inputChoice, ['value', 'label'], 'choice');
        text(choice.value, 'choice value', 4096); text(choice.label, 'choice label', 4096);
        if (!choice.value || options.has(choice.value)) invalid('duplicate or empty choice');
        options.add(choice.value);
      }
      if (field.value !== '' && !options.has(field.value as string)) invalid('selected choice');
    } else if (field.choices !== undefined) invalid('choices on non-choice field');
    if (field.geometry !== undefined) {
      const geometry = record(field.geometry, ['pageIndex', 'rect'], 'geometry');
      if (!Number.isInteger(geometry.pageIndex) || (geometry.pageIndex as number) < 0) invalid('page index');
      const rect = record(geometry.rect, ['x', 'y', 'width', 'height'], 'rectangle');
      for (const key of ['x', 'y', 'width', 'height']) if (typeof rect[key] !== 'number' || !Number.isFinite(rect[key])) invalid('rectangle coordinate');
      if ((rect.width as number) < 0 || (rect.height as number) < 0) invalid('rectangle dimensions');
    }
  }
  if (JSON.stringify(input).length > 63999) invalid('definition exceeds the 63,999 character SharePoint list column limit');
  return JSON.parse(JSON.stringify(input)) as FormDefinition;
}

export function validateValues(definition: FormDefinition, input: unknown): Record<string, string | boolean> {
  const values = record(input, definition.fields.map(field => field.id), 'response values');
  const result: Record<string, string | boolean> = {};
  for (const field of definition.fields) {
    if (!Object.prototype.hasOwnProperty.call(values, field.id)) invalid(`missing response ${field.id}`);
    const value = values[field.id];
    if (field.kind === 'checkbox') { if (typeof value !== 'boolean') invalid('checkbox response'); }
    else text(value, 'text response');
    if (field.readOnly && value !== field.value) invalid('read-only response');
    if (field.required && (value === false || (typeof value === 'string' && !value.trim()))) invalid(`${field.label}: required`);
    if ((field.kind === 'choice' || field.kind === 'radio') && value !== '' && !field.choices!.some(choice => choice.value === value)) invalid('unknown choice response');
    result[field.id] = value as string | boolean;
  }
  if (JSON.stringify(result).length > 63999) invalid('response exceeds the 63,999 character SharePoint list column limit');
  return result;
}

export function validateSubmission(definition: FormDefinition, input: unknown): Submission {
  const payload = record(input, ['formId', 'definitionVersion', 'submissionId', 'values'], 'submission');
  if (payload.formId !== definition.id || payload.definitionVersion !== 1) invalid('response form/version');
  if (typeof payload.submissionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.submissionId)) invalid('submission nonce');
  return { formId: definition.id, definitionVersion: 1, submissionId: payload.submissionId, values: validateValues(definition, payload.values) };
}
