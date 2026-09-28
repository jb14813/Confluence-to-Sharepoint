// A page's title area, SharePoint's Title Region web part: in LayoutWebpartsContent on pages made through the page
// API (as the extension makes them); in CanvasContent1, as the first section ("Banner"), on pages made in
// SharePoint's editor, whose properties also keep the title as markup (htmlTitle).
export const TITLE_COMPONENT = 'cbe7b0a9-3504-44dd-a3a3-0e5cacd07788';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** Whether a layout part (its `id`) or a canvas control (its web part) is the title area. */
export const isTitleArea = part => same(part?.id, TITLE_COMPONENT) || same(part?.webPartId, TITLE_COMPONENT) || same(part?.webPartData?.id, TITLE_COMPONENT);

/** Sets the title, and with an attribution the byline and date, in a title area's properties; its banner picture, layout and the rest stay. */
export function applyTitle(properties, title, attribution) {
  properties.title = title;
  // The same heading with the new title, or left out when it is not a plain heading: SharePoint then shows `title`.
  if (typeof properties.htmlTitle === 'string') {
    const heading = /^<(h[1-6])(\s[^<>]*)?>[^<>]*<\/\1>$/i.exec(properties.htmlTitle.trim());
    if (heading) properties.htmlTitle = `<${heading[1]}${heading[2] ?? ''}>${escapeHtml(title)}</${heading[1]}>`;
    else delete properties.htmlTitle;
  }
  if (attribution) {
    properties.topicHeader = attribution.topicHeader;
    properties.showTopicHeader = true;
    properties.showPublishDate = false;
    if (attribution.user) {
      properties.authorByline = [attribution.user.upn];
      properties.authors = [{ id: attribution.user.loginName, name: attribution.user.title, role: '', upn: attribution.user.upn }];
    }
  }
  return properties;
}
