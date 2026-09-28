// The site's Site Pages library, where pages are made and written, and what the signed-in user may do there.
import { GUID, checkedPath, fail, same } from './session.js';

/** The site, its web and its one Site Pages library, which must keep minor versions (drafts) and let the user view, add and edit pages. */
export async function inspectSite({ request, site }) {
  const siteData = await request('site?$select=Id');
  const web = await request('web?$select=Id,Url,ServerRelativeUrl');
  if (!GUID.test(siteData?.Id ?? '') || !GUID.test(web?.Id ?? '') || !same(web.Url?.replace(/\/$/, ''), site.url) ||
      !same(web.ServerRelativeUrl?.replace(/\/$/, ''), site.path)) throw fail('invalid-site', 'SharePoint returned identities for a different or unverified site.');
  const collection = await request('web/lists?$select=Id,Title,BaseTemplate,EnableVersioning,EnableMinorVersions,EnableModeration,EffectiveBasePermissions,RootFolder/ServerRelativeUrl,RootFolder/ServerRelativePath&$expand=RootFolder&$filter=BaseTemplate%20eq%20119');
  const lists = collection?.value ?? collection?.results;
  if (!Array.isArray(lists) || collection?.['odata.nextLink'] || collection?.['@odata.nextLink'] || collection?.__next) throw fail('invalid-library', 'Site Pages library discovery was incomplete.');
  const candidates = lists.filter(list => list.BaseTemplate === 119);
  if (candidates.length !== 1) throw fail('invalid-library', 'A single Site Pages library is required for new drafts.');
  const list = candidates[0];
  const path = checkedPath(list.RootFolder?.ServerRelativePath?.DecodedUrl ?? list.RootFolder?.ServerRelativeUrl);
  if (!GUID.test(list.Id ?? '') || typeof list.Title !== 'string' || !same(path.slice(0, path.lastIndexOf('/')), site.path)) {
    throw fail('invalid-library', 'The page library is outside the selected SharePoint site.');
  }
  if (list.EnableVersioning !== true || list.EnableMinorVersions !== true || typeof list.EnableModeration !== 'boolean') throw fail('draft-unavailable', 'The Site Pages library must confirm versioning and minor drafts before importing.');
  const low = String(list.EffectiveBasePermissions?.Low ?? '');
  if (!/^\d+$/.test(low) || Number(low) > 0xffffffff || (BigInt(low) & 7n) !== 7n) throw fail('permission-unverified', 'View, add and edit permissions for the Site Pages library could not be confirmed.');
  // Delete Items (8) lets SharePoint rename a page's file, as it does to name a new page after its first title.
  return { siteUrl: site.url, siteId: siteData.Id, webId: web.Id, pagesLibrary: { listId: list.Id, title: list.Title, serverRelativeUrl: path,
    enableVersioning: true, enableMinorVersions: true, enableModeration: list.EnableModeration, canRename: (BigInt(low) & 8n) === 8n } };
}
