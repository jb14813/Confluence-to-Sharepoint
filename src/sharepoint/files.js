// A page's file in Site Pages: checking it in as a minor version, and undoing a check-out.
import { checkedPath, encode } from './session.js';

/** The REST resource of the file at a decoded server-relative path. */
export const fileResource = path => `web/GetFileByServerRelativePath(decodedUrl='${encode(checkedPath(path).replace(/'/g, "''"))}')`;
export const CHECK_IN = "CheckIn(comment='',checkintype=0)";
// CheckOutType 2 is "none": nobody has the file checked out.
const CHECKED_IN = 2;

// A check-in whose answer was lost (timed out or not delivered) may or may not have been made, so the file is read
// back before it is tried again. In the 0.5.0 run 1 of 77 sends spent two 20-second timeouts on its check-in and left
// the draft checked out; checking it in by hand then worked at once. How long a lost check-in takes to land, if it
// does, was not measured; the file is read back after a moment.
const LOST = new Set(['request-timeout', 'request-network']);
const LOST_PAUSE_MS = 2000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Checks the page in as a minor version, so it stays an unpublished draft that others can co-author, as drafts
 * made in SharePoint's editor are. SharePoint refuses it where the library has a required column without a value
 * (HTTP 500 "You must fill out all required properties…"); the page then stays checked out to the
 * signed-in user with its content, and the note says why. A refusal is not tried again; a check-in whose answer
 * was lost is read back, and tried once more (with a fresh digest) only if the file is still not checked in. One the
 * file cannot be read after, SharePoint having accepted it or its answer lost, is reported as unconfirmed.
 */
export async function checkInMinor({ request, freshDigest, pause = wait }, path, what = 'page') {
  // `unsettled`: a check-in went out that SharePoint accepted, or whose answer was lost, and no read of the file has
  // shown it since; a refusal after it does not settle it, as the first may have landed. A check-in without a request
  // token never went out, so it is not a lost one: it is not read back for, nor tried again, as the session has
  // already asked three times for the token.
  let failure = null, file = null, unsettled = false;
  const attempt = async () => {
    let digest;
    try { digest = await freshDigest(); } catch (error) { failure = error; return; }
    try { await request(`${fileResource(path)}/${CHECK_IN}`, { method: 'POST', digest, ignoreBody: true }); failure = null; }
    catch (error) { failure = error; }
    unsettled ||= !failure || LOST.has(failure.code);
  };
  const readBack = async () => { file = await request(`${fileResource(path)}?$select=CheckOutType,UIVersionLabel`).catch(() => null); if (file) unsettled = false; };
  await attempt();
  if (unsettled && failure) {
    await pause(LOST_PAUSE_MS);
    await readBack();
    if (file?.CheckOutType !== CHECKED_IN) await attempt();
  }
  if (file?.CheckOutType !== CHECKED_IN) await readBack();
  if (file?.CheckOutType === CHECKED_IN) return { checkedIn: true, version: file.UIVersionLabel };
  if (unsettled) {
    const why = failure ? `SharePoint did not answer the check-in, and the ${what} could not be read afterwards to see whether it was checked in.`
      : `SharePoint accepted the check-in, but the ${what} could not be read afterwards to confirm it.`;
    return { checkedIn: false, note: `${why} If it is still checked out to you, others can’t edit it until you publish it or check it in.` };
  }
  const said = typeof failure?.answer?.said === 'string' ? failure.answer.said : '';
  const kept = failure?.code === 'request-network' ? `SharePoint could not be reached to check the ${what} in, so it was left checked out to you.`
    : failure?.code === 'request-timeout' ? `SharePoint did not answer the check-in in time, so the ${what} was left checked out to you.`
    : `SharePoint left the ${what} checked out to you${said ? `: ${said}` : '.'}`;
  return { checkedIn: false, ...(typeof file?.UIVersionLabel === 'string' ? { version: file.UIVersionLabel } : {}),
    note: `${kept} Until you publish it or check it in, others can’t edit it.` };
}

/** Undoes a check-out this send made, so the page is as it was before; true once SharePoint shows it checked in. */
export async function undoCheckOut({ request, freshDigest }, path) {
  try { await request(`${fileResource(path)}/UndoCheckOut()`, { method: 'POST', digest: await freshDigest(), ignoreBody: true }); } catch { /* Confirmed below. */ }
  try { return (await request(`${fileResource(path)}?$select=CheckOutType`))?.CheckOutType === CHECKED_IN; } catch { return false; }
}
