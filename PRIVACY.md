# Privacy

Confluence to SharePoint processes the Confluence page open in Chrome and creates a native unpublished page in the SharePoint site selected by the user. It has no developer-operated server, analytics, advertising, or telemetry.

The extension uses this data only to perform the transfer requested by the user. The developer does not sell or transfer it to third parties, use it for advertising, or use it to determine creditworthiness or lending eligibility. The SharePoint copy is delivered only to the destination site the user selects.

## Data processed

During capture, the extension reads the open Confluence page's title, author, update date, supported text and layout, links, and pictures. A Confluence live doc, or a page open in Confluence's editor (including a draft never published), has no reading view, so its content is read from the page's stored document: for a page in the editor, the draft Confluence saves while the editor is open. Pictures and files are identified in the attachment lists of the page, or of another page on the same Confluence site whose files it shows, when Confluence has not finished describing them on screen or the page is a live doc or open in the editor. When a capture is sent, the extension reads the selected SharePoint site's metadata and the responses needed to verify the new draft and its uploaded pictures.

On Confluence Cloud pages, a content script checks the page's Confluence markup and address and adds the **SharePoint** button beside Share on document pages. Opening the popup over a Confluence page inspects that tab: it recognizes Confluence from the page's own markup and reads the page's title and page type from that same site with the existing signed-in session. Full document capture begins only when the user selects **Capture page**. When the user sends a capture, the extension opens the chosen SharePoint site in a background tab and reads the site's address, name, and Site Pages library settings and permissions there before creating the draft.

**Remembered SharePoint sites.** When the user opens a SharePoint Online page (not a personal OneDrive or the SharePoint admin center), a content script reads that site's address and name from the page itself. When SharePoint has moved to another page without reloading, so the page no longer names the site its address belongs to, the script asks that same SharePoint site for its address and name instead, with a read request made under the user's own sign-in. The extension keeps them in Chrome's extension storage on this computer so the user can send pages there. They are never sent anywhere. The user can remove them, one at a time or all at once, in the popup's **Sites** view; uninstalling the extension deletes them.

The extension uses the existing signed-in browser sessions for Atlassian and SharePoint. It does not extract, copy, log, or persist browser cookies, access tokens, or passwords. It obtains a SharePoint request digest for authorized same-site writes, uses it in memory, and does not log or persist it.

## Storage and retention

The captured model and verified picture bytes are stored in extension-owned browser storage for the current Chrome session. **Clear** in the popup deletes that local capture. A later browser session discards any prior capture record that is no longer accessible to the session.

Remembered SharePoint sites (address, name, when the site was last visited or used, whether it is pinned, and the reason a site could not take a draft) are kept in the extension's local storage on this computer, where only the extension's own pages can read them, at most 30 of them, until the user removes them or uninstalls the extension.

A send writes picture files to the selected site's Site Assets library and creates one new unpublished page in its Site Pages library. Those SharePoint files remain until a SharePoint user deletes them. **Clear** does not delete SharePoint content because a stopped send may already have produced a draft or files that require review.

## Network access

Network requests go to the signed-in Atlassian and SharePoint sites, and to another website only for a picture a Confluence page shows from it. Pictures are downloaded through Confluence's original-attachment link, which forwards to Atlassian's media service (`api.media.atlassian.com`) with a signed address; the extension's cookies are sent only to the Confluence site itself. `media-cdn.atlassian.com` is used only as a validated fallback when the original Confluence attachment route is blocked. A picture a Confluence page shows from another website, rather than as an attachment, is requested from that website so it can be copied into SharePoint. The request sends no cookies and no page address; as with any cross-site request, the browser tells that website the address of the Confluence site (not the page). The picture is copied only if the website allows the Confluence site to read it; otherwise it becomes a link to it. External smart-link favicons are neither contacted nor copied. Remembering SharePoint sites makes no network request. The extension does not send captured content or remembered sites to the developer or any analytics service.

## SharePoint publishing

The extension creates an unpublished minor draft and opens it for review. It has no Publish, Submit for approval, Schedule, or Promote operation. Publishing remains an explicit SharePoint user action.

## Permissions

- `scripting` recognizes a Confluence page in the tab the popup opens over, reads supported page content from it, and performs signed-in SharePoint requests in the site tab a send opens.
- `storage` holds the session-bound capture, picture bytes, progress, and safe recovery state, and the remembered SharePoint sites.
- Host permissions are restricted to `*.atlassian.net`, `media-cdn.atlassian.com`, and `*.sharepoint.com`. The content script on SharePoint Online pages, which does not run on personal OneDrive or the admin center, only reads the site's address and name from the page.
- The toolbar popup, which holds the Capture and Send controls, needs no permission of its own.
