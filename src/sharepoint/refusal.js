// What SharePoint answered when it refused a request, for the message the user
// sees: SharePoint's own explanation, or the title of a web page that answered
// instead, as a network filter's block page does. One short sentence, never an address.
const MAX_ANSWER = 64_000;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };
const tidy = value => value.replace(/https?:\/\/\S+/gi, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
/** SharePoint's own words as one short sentence, without addresses. */
export const sentence = value => {
  const text = tidy(value).slice(0, 240).replace(/[\s,;:]+$/, '');
  return !text ? '' : /[.!?]$/.test(text) ? text : `${text}.`;
};

/** Reads a refused response: `{said}` with SharePoint's explanation, `{page}` with the title of another answer, or `{}`. */
export async function refusalDetail(response) {
  let text = '';
  try {
    if (Number(response.headers.get('Content-Length')) > MAX_ANSWER) return {};
    text = (await response.text()).slice(0, MAX_ANSWER);
  } catch { return {}; }
  try {
    const data = JSON.parse(text), error = data?.['odata.error'] ?? data?.error;
    const said = sentence(String((typeof error?.message === 'string' ? error.message : error?.message?.value) ?? ''));
    if (said) return { said };
  } catch { /* Not SharePoint's error format. */ }
  const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(text)?.[1];
  const page = title ? tidy(title.replace(/&(amp|lt|gt|quot|#39|apos);/g, (match, name) => ENTITIES[name])).slice(0, 80) : '';
  return page ? { page } : {};
}

/** `base` names the refused request and its status, as "SharePoint refused to save the page (HTTP 403)". */
export function withAnswer(base, { said, page } = {}) {
  if (said) return `${base}: ${said}`;
  if (page) return `${base}. Its answer was a web page titled “${page}” rather than SharePoint’s usual error, as when a network filter blocks a request.`;
  return `${base} without saying why.`;
}
