/*!
 * SurveyJS Form Library - MIT License
 * Copyright (c) 2015-2026 Devsoft Baltic OÜ - http://surveyjs.io/
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { Model } from 'survey-core';
import { renderSurvey } from 'survey-js-ui';
import { validateDefinition, validateValues } from './definition';
import type { FormDefinition, SavedSubmission, Submission } from './definition';
export { validateDefinition, validateValues, validateSubmission } from './definition';
export type { FormDefinition, FormField, Submission, SavedSubmission } from './definition';

export interface MountOptions { submit: (payload: Submission) => Promise<SavedSubmission> }
export interface MountedForm {
  model: Model;
  getValues: () => Record<string, string | boolean>;
  submit: () => Promise<boolean>;
  dispose: () => void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Mount only our allowlisted document contract, never document-provided SurveyJS JSON. */
export function mountForm(container: HTMLElement, input: FormDefinition, options: MountOptions): MountedForm {
  const definition = validateDefinition(input);
  if (!options || typeof options.submit !== 'function') throw new Error('A submission callback is required');
  const pages = new Map<number, unknown[]>();
  for (const field of definition.fields) {
    const page = field.geometry?.pageIndex ?? 0;
    if (!pages.has(page)) pages.set(page, []);
    const type = field.kind === 'checkbox' ? 'boolean' : field.kind === 'choice' ? 'dropdown' : field.kind === 'radio' ? 'radiogroup' : field.multiline ? 'comment' : 'text';
    pages.get(page)!.push({
      type, name: field.id, title: field.label, defaultValue: field.value,
      isRequired: field.required, readOnly: field.readOnly,
      ...(field.kind === 'checkbox' ? { renderAs: 'checkbox' } : {}),
      ...(field.choices ? { choices: field.choices.map(choice => ({ value: choice.value, text: choice.label })), showNoneItem: false, allowClear: !field.required } : {})
    });
  }
  const model = new Model({
    title: definition.title, showQuestionNumbers: 'off', showCompleteButton: false,
    showNavigationButtons: false, textUpdateMode: 'onTyping',
    elements: Array.from(pages.entries()).sort((a, b) => a[0] - b[0]).map(([page, elements]) => ({ type: 'panel', name: `page_${page}`, title: `Page ${page + 1}`, elements }))
  });
  // SurveyJS normally treats title strings as text. Explicitly encode its optional markdown path as well.
  model.onTextMarkdown.add((_sender, event) => { event.html = escapeHtml(event.text); });
  const shell = document.createElement('section'); shell.className = 'file-import-form';
  const renderer = document.createElement('div');
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'file-import-form-submit'; button.textContent = 'Submit response';
  shell.append(renderer, status, button); container.replaceChildren(shell);
  renderSurvey(model, renderer);
  let sending = false; let saved = false; let disposed = false; let pending: Submission | undefined;
  const getValues = (): Record<string, string | boolean> => {
    const values: Record<string, string | boolean> = {};
    for (const field of definition.fields) values[field.id] = field.readOnly ? field.value : (model.getValue(field.id) ?? (field.kind === 'checkbox' ? false : ''));
    return values;
  };
  const submit = async (): Promise<boolean> => {
    if (sending || saved || disposed) return false;
    if (!pending) {
      try {
        if (!model.validate()) { status.textContent = 'Complete the required fields before submitting.'; return false; }
        pending = { formId: definition.id, definitionVersion: 1, submissionId: crypto.randomUUID(), values: validateValues(definition, getValues()) };
      } catch (error) { status.textContent = error instanceof Error ? error.message : 'Check the form values.'; return false; }
    }
    sending = true; button.disabled = true; model.mode = 'display'; status.textContent = 'Saving response…';
    try {
      const result = await options.submit({ ...pending, values: { ...pending.values } });
      if (!result || result.status !== 'saved' || result.submissionId !== pending.submissionId) throw new Error('The response was not confirmed by SharePoint.');
      // The synchronous sending guard above admits exactly one request until finally.
      // eslint-disable-next-line require-atomic-updates
      saved = true;
      status.textContent = 'Your response was saved.'; button.textContent = 'Response saved';
      return true;
    } catch (error) {
      status.textContent = `Response not confirmed. Your values are retained. Check and retry explicitly with the same submission ID. Submission reference: ${pending.submissionId}. ${error instanceof Error ? error.message : ''}`;
      button.textContent = 'Check and retry submission';
      return false;
    } finally {
      // eslint-disable-next-line require-atomic-updates
      sending = false;
      button.disabled = saved || disposed;
    }
  };
  button.addEventListener('click', () => { submit().catch(() => { status.textContent = 'Response not confirmed. Your values are retained.'; }); });
  return { model, getValues, submit, dispose: () => { disposed = true; model.dispose(); shell.remove(); } };
}
