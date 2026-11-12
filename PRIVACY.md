# Confluence to SharePoint privacy policy

Confluence to SharePoint imports content you choose into the SharePoint site you select. It uses your existing signed-in accounts and has no developer-operated conversion server, advertising, analytics or telemetry.

## Data processed

The extension processes the Confluence content or local document you select, including supported text, images, links, formatting, file names, form information and document metadata. Confluence metadata may include the author's name or email address and the source's edit date or version. These are used to reconstruct content and, where appropriate, page attribution in SharePoint.

It also reads relevant Confluence and SharePoint site/page addresses, titles, account identifiers, permissions and page status. This supports destination choices, source updates, draft verification and avoiding conflicting or repeated writes. It reads relevant open tabs for these features; it does not collect a general browsing history or use browsing activity for advertising or profiling.

## Storage and retention

The current capture or conversion and its images are kept in extension-owned browser storage so the requested import can finish or resume. This working data is replaced or cleared through the extension and expires with its browser or extension session. A limited recovery record may remain until an interrupted operation is reviewed or resolved.

The extension remembers preferences and transfer metadata such as site/page addresses, titles, import times, source versions, imported section identifiers and operation status. These support destination selection, history and Confluence updates. History does not retain original local files, local file paths, document bodies or image bytes. Local files are not watched or compared for changes.

Remembered records stay locally until removed through the extension, replaced by its retention limits or deleted by uninstalling it. Removing a destination or clearing remembered history removes the corresponding records. Clearing local working data does not delete content already created in SharePoint.

Pinned sites and the account-storage preference can follow Chrome sync through your Google account. If you enable Confluence account storage, Confluence transfer records are also stored in your own Confluence account to support access across browsers. File working data and file-import history are not synced to Confluence or Chrome. Turn account storage off before uninstalling if you want the extension to remove its Confluence copy; uninstalling alone does not remove that remote copy. Requested remote removals may wait until the service is reachable and you are signed in.

## Local files and forms

Local conversion runs inside Chrome. The original source file is not uploaded to a conversion service or to the developer. When you request an import, reconstructed page content, images and supported form information are sent to your selected SharePoint site using your existing permissions.

If a file references images it does not contain, the extension identifies their source websites and asks before fetching them. Those websites receive image requests and ordinary connection information, such as your IP address and browser origin. These requests omit cookies and the referring page address; the document file is not uploaded to those websites.

Source scripts and macros are not executed. Form information is used only to recreate supported content in SharePoint. Content and answers you subsequently edit or save in SharePoint are managed there under your organization's permissions and retention policies.

## Network access and sharing

Requests go to the Atlassian and Microsoft services needed for your selected sources and destinations. Confluence images may be delivered through Atlassian's media services. External image hosts are contacted only for content-related image retrieval as described above. Google receives synced settings only when Chrome sync is enabled. These services process requests under their own terms and privacy policies.

The developer does not receive imported content, transfer history or account credentials, and does not sell data or use it for advertising, data brokerage or credit decisions. Opening support, source, license or website links is your choice and may contact those services. If you send a support request, the recipient receives the information you choose to include; avoid private document content unless you intend to share it.

User data is transmitted over secure connections. The extension uses browser-managed sign-ins and does not extract or retain passwords, session cookies or access tokens. Temporary request data and account-scoped recovery information are used only to perform and verify the requested operation.

## SharePoint publishing

Imports are saved as unpublished drafts. You review, edit and publish in SharePoint. Existing site permissions, approval rules, sharing and version history remain under your organization's control. The extension does not grant access or make imported content public. SharePoint content remains there until an authorized user removes it.

## Permissions

Site access and scripting are used to read supported source pages, recognize destinations and perform the transfers you request. Browser storage holds the working data, preferences, history and recovery information described above. Permissions are used only for the extension's content-import features.

Our use of data accessed through Chrome APIs follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Contact and policy changes

Contact support@jzbapps.com for questions or requests concerning the extension. Your organization or service provider controls content already stored in its Confluence or SharePoint environment.

We update this policy when data practices change. Technical setup, supported-format details and release information are maintained in the project's GitHub documentation.
