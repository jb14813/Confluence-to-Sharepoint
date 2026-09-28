// A page's file in Site Pages: checking it in as a minor version, and undoing a check-out.
import { checkedPath, encode } from './session.js';

/** The REST resource of the file at a decoded server-relative path. */
export const fileResource = path => `web/GetFileByServerRelativePath(decodedUrl='${encode(checkedPath(path).replace(/'/g, "''"))}')`;
export const CHECK_IN = "CheckIn(comment='',checkintype=0)";
// CheckOutType 2 is "none": nobody has the file checked out.
const CHECKED_IN = 2;

/**
 * Checks the page in as a minor version, so it stays an unpublished draft that others can co-author, as drafts
 * made in SharePoint's editor are. SharePoint refuses it where the library has a required column without a value
 * (HTTP 500 "You must fill out all required properties…"); the page then stays checked out to the
 * signed-in user with its content, and the note says why.
 */
export async function checkInMinor({ request, freshDigest }, path, what = 'page') {
  let refusal = null;
  try { await request(`${fileResource(path)}/${CHECK_IN}`, { method: 'POST', digest: await freshDigest(), ignoreBody: true }); }
  catch (error) { refusal = error; }
  let file = null;
  try { file = await request(`${fileResource(path)}?$select=CheckOutType,UIVersionLabel`); } catch { /* Reported as not confirmed. */ }
  if (file?.CheckOutType === CHECKED_IN) return { checkedIn: true, version: file.UIVersionLabel };
  const said = typeof refusal?.answer?.said === 'string' ? refusal.answer.said : '';
  return { checkedIn: false, ...(typeof file?.UIVersionLabel === 'string' ? { version: file.UIVersionLabel } : {}),
    note: `SharePoint left the ${what} checked out to you${said ? `: ${said}` : '.'} Until you publish it or check it in, others can’t edit it.` };
}

/** Undoes a check-out this send made, so the page is as it was before; true once SharePoint shows it checked in. */
export async function undoCheckOut({ request, freshDigest }, path) {
  try { await request(`${fileResource(path)}/UndoCheckOut()`, { method: 'POST', digest: await freshDigest(), ignoreBody: true }); } catch { /* Confirmed below. */ }
  try { return (await request(`${fileResource(path)}?$select=CheckOutType`))?.CheckOutType === CHECKED_IN; } catch { return false; }
}
