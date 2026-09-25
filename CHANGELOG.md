# Changelog

## 0.3.12 - Unreleased

- Captured pages open in Confluence's editor, including drafts that were never published. Until now the extension read only a page's reading view. In the editor it said "Open a Confluence page in its normal reading view", and a new draft, which opens only in the editor, could not be captured at all. The SharePoint button now also appears beside Share in the editor. Capture copies what the editor shows: the draft Confluence saves while the editor is open, read through Confluence's REST API (`status=draft`). If Confluence has no draft of the page yet, capture reads the published page. The draft goes through the same conversion as live docs. Confluence saves as you type, so capture waits up to five seconds for the saved draft to match the editor, title included. If it still doesn't match, a note says so, and **Capture again** picks up the rest. The SharePoint byline names the page's creator. A draft never published names none, so the byline names the author of the draft's version. A new draft with no title yet asks for one, since a SharePoint page needs a title.

## 0.3.11 - Unreleased

- Kept a roadmap's months. Confluence's roadmap macro (the Roadmap Planner) draws its timeline as a picture: the months and years along the top, a strip for each lane, the bars across the months they last, and markers such as "Current Status". The drafts lost that picture and kept only the lane and bar titles as a list, with no months and nothing saying which bar belongs to which lane. A roadmap is now a table drawn from the data the page stores for it:
  - the months as columns, labelled as Confluence labels them, with the year on the first month and on each January;
  - a row for each lane, its name in the lane's color;
  - each bar in the months its dates cover, in its color;
  - each marker below its month.

  Bars that start or end mid-month cover the whole month, and a bar that would then overlap another moves to the next row.
- Drew a horizontal rule as SharePoint's Divider web part, the line SharePoint's own editor adds between parts of a page. The drafts had shown a rule as a short line of "─" characters, because SharePoint's page view draws a real line (`<hr>`) but its editor removes it when the page is saved. A rule inside a table, panel, list or quote keeps the line of characters, since a web part cannot go there. A Divider is written with the data SharePoint's editor stores for one it adds.

## 0.3.10 - Unreleased

- Drew panels and decision boxes without borders in SharePoint's page view, not only in its editor. 0.3.9 wrote them in SharePoint's own borderless table markup and checked them in SharePoint's editor, where a new draft opens. SharePoint's page view still drew them with a black border. SharePoint defines its borderless table style only for its current editor, CKEditor 5. It draws a page with that editor only when the page's settings say its text is written for it. SharePoint's own editor marks every page it saves that way (`rtePageSettings`, content version 5), and PnP Core, Microsoft's SharePoint library, writes the same. The drafts had no such mark, so SharePoint drew them with its earlier editor's reader. Drafts now carry the mark.
- Kept the lines Confluence draws text in. Confluence keeps every space and line break an author or template typed. So templates can show:
  - cells several lines tall;
  - indented labels, such as the Prioritization Matrix's "Impact: High";
  - blank numbered items under "Must do";
  - headings indented by a leading space.

  HTML, and so SharePoint, collapses spaces and line breaks. The drafts showed thin rows, no numbered items, and lines run together. Now:
  - line breaks stay line breaks;
  - spaces that begin a line or follow another space become no-break spaces;
  - a final line break, which Confluence does not draw, is left out.

  The capture reads from the page's style which text Confluence draws this way. Code blocks and labels keep their own text.
- Kept what Confluence draws even when nothing is written in it:
  - an empty panel, with its color and icon (the Prioritization Matrix's "Goals" box);
  - empty numbered and bulleted items, with their numbers or bullets;
  - an empty code block, as a grey block one line tall (the Design systems template has six);
  - blank lines.

  A paragraph with nothing in it, which Confluence draws zero height, is still left out.
- Drew table cells from their top, as Confluence does. SharePoint centered their content, so a label beside a tall cell sat in the middle of the row.
- Gave status, date and mention labels the room Confluence gives them inside their color: 4 pixels each side, measured. SharePoint keeps no padding, so each label has a no-break space at each end, and SharePoint's editor keeps them. Labels no longer run into the text beside them, as "IN PROGRESS/COMPLETE" did.
- Kept a send going when SharePoint is briefly too busy.
  - A busy SharePoint can answer a read with HTTP 503, or not answer a content save in time, leaving an empty draft.
  - As Microsoft advises for throttled SharePoint requests, a read is now made again at most twice. The wait is what SharePoint asks for, at most 30 seconds, otherwise 1 and then 2 seconds.
  - A content save that did not land is made once more. This is safe because a save sets the whole page and the page is the send's own.
  - Page creation is still never repeated.
- A code block Confluence draws without rows no longer ends with an extra line break.

## 0.3.9 - Unreleased

- Kept Confluence column layouts as SharePoint columns. Confluence now marks a column layout `data-layout-section` and its columns `data-layout-column` (with `data-column-width`), which the capture did not recognize, so every layout's columns were stacked in the page's one column; in Confluence's older markup a layout became a table. Each layout now becomes a SharePoint section with the nearest columns: halves, a third beside two thirds, or three equal columns. A layout with four or more columns is split into rows of up to three, and one SharePoint has no match for, such as a wide middle column, gets the nearest columns with a note. Pictures and text stay in their columns. A layout inside a table, panel, list or quote, where SharePoint sections cannot go, stays side by side in a table. Live docs get the same columns.
- Showed pictures at the width Confluence shows them. The capture took the author's pixel width even where Confluence fits a picture into less, such as a column: a picture set at 442 pixels shows at 221 in a third of the page, and the draft showed it at 442. The width is now the author's, capped by the space Confluence gives the picture, and a picture in a SharePoint column is at most as wide as that column.
- Wrote every Confluence emoji as an emoji, never as its name. Emoji Confluence stores only by name came across as that name, such as `:minus:`, `:plus:`, `:flag_on:` and `:key:` in Confluence's templates: Atlassian's own emoji and custom emoji are pictures, and SharePoint text holds a picture only as a separate aligned image, never inside a line. The complete lists Confluence's editor offers were read from Confluence's emoji service: 1,890 standard emoji, which carry their character, and 590 of Atlassian's own. Each of Atlassian's now has the nearest Unicode emoji, chosen beside its picture, and its numbers and stars keep their measured color (a purple ❶, a red ★). A custom emoji gets the standard emoji of the same name, then Atlassian's emoji of that name, then the standard emoji whose name and keywords match best; the names come from emojibase-data (MIT license, with Unicode CLDR data). The key, wave and note emoji in Atlassian's templates, which come from another site and which Confluence itself draws as "�" here, become 🔑, 👋 and 📄. A custom emoji with nothing similar is left out and named in a note. The capture reads an emoji from the element holding its name instead of from its drawing. A link to a Confluence page keeps the page's emoji before its title, a custom panel keeps an icon Confluence gives only by its emoji id, and a character drawn as plain text by default (such as the spiral notepad) is marked to be drawn as an emoji, so it no longer shows as a box.
- Left out Confluence's template hints, as Confluence does for readers. A template's instructions, such as "type // to add date", show only in Confluence's editor, and its reading view shows nothing in their place. The capture wrote them into drafts as ordinary text, so a template page's draft showed text Confluence does not, including instructions for Confluence's editor. A hint Confluence does show, as in some expanded sections, is copied like any text.
- Kept Confluence's text formatting where SharePoint can show it, in the colors of Confluence's light theme (measured): a status is its small colored label, a date and a mention its grey label, a header cell without a color of its own is grey, and a numbered table keeps its grey number column, 42 of Confluence's 760 pixels wide, with header rows unnumbered. Task and decision lists show each item's box or mark without a bullet, nested items indented: a done task has a blue ☑, an open one ☐, and decisions a green ⑂ in the grey box Confluence draws them in. They are lines of one paragraph, because SharePoint's editor turns any list back into bullets; a task holding a table, list or code block stays a list item. Each form was checked in SharePoint's page and its editor. An empty table is kept, as Confluence shows its grid.
- Kept code blocks' lines when a draft is edited. A code block was a grey table cell whose lines were line breaks in its text; SharePoint shows that page as it should, but its editor, where a new draft opens, joins the lines into one, and saving from the editor would keep them joined. A code block is now preformatted text (`<pre>`), which SharePoint draws as a grey block and whose editor keeps every line and space; code copied from it has ordinary spaces. Inline code keeps Confluence's grey background.
- Drew panels as Confluence draws them now: each standard panel in Confluence's current color (measured in its light theme; the colors had been Atlassian's earlier ones) with the emoji nearest its icon before its text: ℹ️ info, 📄 note, ✅ success, ⚠️ warning and ❌ error, the same emoji Confluence's "Using the editor" template uses for them. Custom panels keep their color and icon. Panels, and decision boxes, no longer have the black table border SharePoint draws around a table: they use SharePoint's own markup for a borderless table, which its editor writes too.
- Drew picked colors as Confluence draws them now. A page stores the color an author picked from Confluence's earlier palette, such as #97A0AF for the grey of template instructions, and Confluence now draws it from its current palette (#7D818A in its light theme); the drafts used the stored colors, a shade off. Text colors, highlights, table cells and custom panels now take the color Confluence draws, read from the page where Confluence gives it and otherwise from its editor's palette (read from Confluence's editor script). A color outside the palette is kept as stored.
- Kept expand section titles. An expand's title is on its toggle button, which capture removes with Confluence's other controls, so a published page's draft kept each expand's content without its title ("How to think about the problem statement" in a template, for example). The title is now a bold paragraph before the content, as in live docs, and the check that every text of the page reached the capture includes expand titles, which Confluence stores apart from the text.
- Left out live forms, such as the Live Search macro's box, with the note for live content. Their labels came across as text ("SearchSearch for anything in this space").

## 0.3.8 - Unreleased

- Created drafts on sites whose members may add and edit pages but not delete them, which had stopped every send there. SharePoint names a new page after the first title it is saved with by renaming its file, and a rename is a move, which needs Delete Items (Microsoft: "If you can't rename a page, contact your site administrator to make sure you have Delete Items permission"). The send's first save gave the new page its unique name as its title. SharePoint kept that title, refused the rename with "Access denied", and left an empty page its author may not delete. 0.3.6 and 0.3.7 took that refusal for the content save's. Now, where the Site Pages library does not grant Delete Items, the send sets the new page's title on its list item before any save (`ValidateUpdateListItem`, the Title field of that one page only), which renames nothing, and then saves the content. The draft keeps the page name SharePoint gave it, such as `Page(3).aspx`, and **Draft created** says why. With Delete Items, drafts are named as before.
- Copied pictures Confluence was still drawing. While a page loads, Confluence first shows each picture as a preview drawn on its server, then adds its own picture card beside it and removes the preview (for about 60 ms both are shown). The capture scrolls pictures into view, which starts that change, and could copy the page in that moment; it then marked every picture "[Picture not copied]" and joined the page into one block of text. The 0.3.8 end-to-end test caught it, and it recurred in 2 of 7 captures of that page. The capture now takes its copy of the page when every picture is in a form it can place, waiting at most 5 seconds; a picture still in another form after that is marked as before. 20 captures of that page in a row then copied all 6 pictures.

## 0.3.7 - Unreleased

- Kept a draft SharePoint refuses part of. SharePoint can create and name the page, then refuse the save of its content with "Access denied". When the content save is refused outright (HTTP 403, so nothing was saved), the send now leaves out, in turn, the Confluence author's byline, then the pictures, then both, and saves the rest; a picture left out is marked “[Picture not placed: name]” where it was, linked to its uploaded copy in the site's Site Assets. The popup names what was left out with **Draft created**. If even the text is refused, a title-only save tells refused text ("SharePoint refused the page’s text") from a page SharePoint no longer lets be changed after it was created, and the message says which.

## 0.3.6 - Unreleased

- Said which request SharePoint refused and what it answered, instead of only its HTTP status: for example "SharePoint refused to save the page (HTTP 403): Access denied. …". An answer that is not SharePoint's own error, such as a network filter's block page, is named by its page title. Addresses are left out. A content save refused with HTTP 403 after the page was created and named showed no reason.

## 0.3.5 - Unreleased

- Left the site's address out of the popup's message when a site's Site Pages do not open in the send's tab; the message says so, and **Show the site’s tab** shows the page itself.

## 0.3.4 - Unreleased

- Opened a site's Site Pages at the library's own address, `<site>/SitePages`, which SharePoint sends to the site's default view, instead of assuming a view named `Forms/AllPages.aspx`. On a site without that view, the send's tab showed SharePoint's "404 NOT FOUND" page and the send stopped. **Review Site Pages** uses the same address.
- Said what the site's tab showed when it is no SharePoint page but is on the site's own address, with that address, instead of asking to sign in; that message is kept for a tab that left the site, as for a sign-in page, whose address Chrome does not show the extension.

## 0.3.3 - Unreleased

- Kept capture going when one piece of a page cannot be copied, instead of stopping the whole capture. A picture whose file cannot be found, downloaded or read, that is in a format capture cannot copy, or that is larger than SharePoint accepts is left out and marked “[Picture not copied: name]” where it was, linked to its file in Confluence when that address is known and safe. A collapsed section that will not open, pictures Confluence never shows, and stored text the capture does not hold are noted; the note on text says where it is and quotes how each passage begins, so it can be found on the page. Unusual list numbering, table merges and header settings, code blocks without readable code, and numbered steps that cannot be read as a list are simplified, with a note. Only verified pictures are ever copied.
- Still stopped a capture where carrying on would give a wrong or unsafe draft: the page changed while it was captured, its stored copy could not be read, it is too large to capture safely, a download came from the wrong place, or nothing could be captured.
- Showed what a capture did not copy in the popup's capture card, in view and apart from the folded layout notes, so it can be checked before sending.

## 0.3.2 - Unreleased

- Captured pages whose table of contents is labeled "Contents". Capture leaves out a table of contents, whose links do not work in SharePoint, together with the label paragraph above it, then checks that every stored text of the page was captured. That check excused only the labels "On this page" and "Table of contents", so a page with a "Contents" label always stopped with "Confluence has not finished rendering all of this page’s source text", although Confluence had shown all of it. The check now excuses exactly the labels capture removed, and no other text.
- Noted, instead of stopping on, text inside a macro's body that Confluence does not show as page text, such as a Marketplace app's macro, which the app draws in a frame of its own, a tab of a tabs macro that is not open, or a synced block. The note names the macros. Capture no longer waits for that text to appear.
- Said where page text is missing when capture still stops for it (for example, one passage in a table), without quoting the page.

## 0.3.1 - Unreleased

- Created drafts on sites below the tenant root, such as `/sites/` and `/teams/` sites. SharePoint reports a new page's `Path` relative to its site (`SitePages/Page.aspx`), and the draft client read it from the tenant root, so on those sites it stopped with "SharePoint returned an unexpected page filename or library path" right after SharePoint created the page, leaving a blank untitled page. A path without a leading slash is now read relative to the chosen site, or from the tenant root only when that reading lies in the site's Site Pages library; at the tenant root the two readings are the same, which is why sends there worked. Version 0.2.21 has the same fault.
- Followed SharePoint moving to another site without reloading. SharePoint's own links change the address in the same page and keep the first page's context, so a `/sites/` site reached from the tenant's home site was remembered as the home site. The site memory now follows each move through Chrome's Navigation API; where the page context was rendered for another address, one read of SharePoint's REST endpoint on the same site confirms the site the address belongs to, and a site confirmed once in a page is not asked about again. SharePoint pages already open when the extension is installed or updated get the site memory too.
- Showed a send's progress to the end. The progress bar keeps moving while a step has nothing to count (opening and checking the site, creating the draft) instead of disappearing or standing full, and creating the draft, which takes several seconds, reports its own steps as they happen: Preparing the draft, Creating the page, Saving the content. With reduced motion the bar stands still, striped. The draft still comes to the front the moment SharePoint confirms it: a SharePoint page in a background tab takes longer to draw, and Chrome reports it loaded long before it is drawn, so holding the tab back until the draft was ready would only make the wait longer.

## 0.3.0 - Unreleased

- Replaced the side panel with the toolbar popup. The button beside Share is now a teal **SharePoint** button with the extension's logo, set apart from Confluence's own buttons and outside the frame around Share, and opens the popup, as does the toolbar icon. Where Chrome cannot show the popup, the popup page opens in a small window of its own.
- Sent a capture to a remembered SharePoint site without visiting it: the extension opens the site's Site Pages in a background tab of the same window, creates the unpublished draft there, then brings the draft to the front. When the site needs a sign-in, the send stops with **Show the site’s tab**.
- Remembered the SharePoint sites the user visits, read from the page itself, and left out personal OneDrive: up to 30, pinned sites first, then the most recently used. The **Sites** view pins, removes and forgets them. A site that cannot take a draft shows why under its name until it is visited again.
- Kept a page that was already sent from staying in front: on another Confluence page the popup starts afresh with **Capture page**, while the sent page itself, and SharePoint tabs, still show its draft. A capture now records which page it came from (site and page id).
- Ran capture and send in the extension's background, so they carry on when the popup closes and the popup shows their progress when it opens again. Capture and import run in their tabs and are followed with short requests, because Chrome stops an extension service worker whose single request lasts more than five minutes. An import that was running when Chrome restarted the background is followed to its end from its tab.
- Asked for site access before sending to a site whose access Chrome withholds from the extension, instead of waiting on a held script. A send stopped after its import started says a draft may already exist; one the site refused before starting can be sent again.
- Kept remembered sites from content scripts, left out the SharePoint admin center, dropped the site used or visited longest ago beyond 30 so a new site is always kept, and noted only lasting problems on a site, not a refused sign-in or a site that did not answer. The Confluence button ignores clicks that do not come from the user.
- Kept the Confluence button working when the extension updates while Confluence pages are open. Chrome disconnects the script already running in them without adding the new one, so the old button answered "Use the extension icon". The extension now adds its script to open Confluence pages when it is installed or updated; the new script hides the old button, placing its own so the two scripts never move their buttons back and forth, which could freeze a page; and a button whose script was disconnected asks to reload the page.
- Required Chrome 127 for `chrome.action.openPopup` and removed the `sidePanel` permission. No permission or host was added; the site memory runs under the existing `*.sharepoint.com` host permission and is kept off personal OneDrive with `exclude_globs`, because Chrome rejects `*-my.sharepoint.com` as a match pattern.

## 0.2.21 - 2026-09-23

- Recognized SharePoint from the page itself instead of its address: SharePoint's own markup identifies the product, the page context it renders names the site, and one same-site REST read confirms it. Tenant roots, `/sites/` and `/teams/` sites, subsites, Site Pages lists, document libraries, Site contents and other `_layouts` pages now select their site. Previously only `SitePages/<page>.aspx` and three `_layouts` routes were accepted.
- Offered a SharePoint site as the destination only when its Site Pages library can hold an unpublished draft for the signed-in user; OneDrive, read-only sites and libraries without draft versions now explain why before any capture is locked by a failed import.
- Recognized Confluence Cloud from its page metadata and renderer rather than its address, with REST and attachment URLs taken from the base address Confluence declares. Space overview pages and legacy `viewpage.action` links can now be captured.
- Followed Confluence's in-app navigation: the panel waits until the page named in the address has rendered, confirmed against that page's title, so it no longer shows or captures the previous page after moving between pages. The To SharePoint shortcut now appears and disappears as Confluence moves between pages and other screens.
- Explained Confluence administration pages and Confluence Data Center or Server pages instead of asking the user to wait for loading.
- Captured Confluence live docs. They have no reading view, so they are captured from their stored Atlassian Document Format into the same SharePoint markup as published pages: headings, lists, check lists, tables with column proportions and cell colors, panels, code, links, dates, mentions, template hints, and pictures downloaded through the original-attachment route. Pictures inside tables, lists or panels and pictures in formats other than PNG, JPEG, GIF, WebP and SVG become links, followed by their captions, with a layout note, and macros that store only settings are omitted with a note.
- Waited up to five seconds for a live doc's stored copy to match its editor, because live docs save as people type; a note explains when recent edits were still unsaved. The comparison uses letters and digits only, so words the editor splits (at a collaborator's cursor, for example) are not mistaken for unsaved edits.
- Recognized a live doc from the page the address names, because Confluence keeps the previous page's id in its page metadata after moving to a live doc in-app.
- Downloaded pictures as the original attachment files. Confluence's download link forwards to Atlassian's media service, which answers any origin only for requests without cookies, so the include-cookies request was always refused and pictures quietly came from Confluence's displayed copies. Cookies now go only to Confluence.
- Captured SVG pictures, such as the artwork on a new space's home page, by drawing them to PNG in the browser at twice the width Confluence shows them.
- Removed the 10 MiB-per-picture and 40 MiB-per-page limits. Pictures now move between the page and the side panel in 8 MB pieces, since Chrome limits one extension message to 64 MiB, and are stored as files rather than text; a picture may be up to 250 MB, SharePoint's limit for one upload request. SharePoint uploads get time for their size instead of a fixed 20 seconds.
- Scaled pictures wider than SharePoint can show (2,408 pixels, twice a SharePoint column) to that width before upload, in their own format; narrower pictures and animated GIFs are uploaded unchanged.
- Displayed each picture at the width Confluence showed it, with the resize settings SharePoint's own editor stores (desired width and height, share of the column, centred), measured from a resize made in SharePoint.
- Captured pictures Confluence had not finished describing on screen (placeholder name "file", no type) by finding them in the page's attachment list, instead of stopping with "missing both attachment metadata and a verifiable rendered image". A picture in another format now names the file in the message.
- Copied pictures a page shows from other websites rather than as attachments, such as the artwork on "Getting started in Confluence", when the website lets other sites read them. The request sends no cookies or page address, and the picture's type is read from the file (SVG only when the website declares it). Other such pictures become links with a note. Previously the page stopped with "An image is missing a valid Confluence attachment identifier or filename."
- Linked pictures inside tables, panels and lists to their files, followed by their captions, as live docs do, instead of stopping capture with "A Confluence attachment is nested in text".
- Captured pages with manually numbered steps. Capture turns "1. …" paragraphs into a numbered list, but the check that no stored text was lost looked for the literal "1." and stopped with "Confluence has not finished rendering all of this page's source text".
- Kept only the title of an inline smart link, without the linked page's icon name or the hover-only "Preview" label, and turned emoji stored by short name (such as :sunglasses:) into the emoji, with standard equivalents for Atlassian's check, cross, info, warning and question-mark emoji.
- Checked every captured part against SharePoint's page rules at capture time, so a page SharePoint would refuse stops before anything is uploaded.
- Kept the space between a Confluence template hint and the link or text that follows it.
- Listed unrecognized Confluence formatting in the layout notes as intended; the check read the wrong inventory fields. Inline comments are recognized, so they do not trigger that note.
- Simplified the side panel to show only the step that applies. The SharePoint step appears once a page is captured, and names the detected site. Status appears only while something runs or when there is a problem. Wording refers to Confluence pages rather than guides. A capture stays visibly captured, with Capture again or Capture this page instead on Confluence pages, and an import ends with an Open draft link.
- Replaced the provisional artwork with the final Confluence to SharePoint logo in the toolbar and extension icons, the panel header, page favicons, and the Store icon, promo tile and screenshot. All are generated from `assets/Confluence_Sharepoint.svg`.
- Kept the panel following a tab that navigates while it is still being inspected.
- Asked for site access when Chrome's site access for the extension is restricted ("On click" or specific sites) instead of waiting indefinitely. Chrome holds script injection into withheld sites, so the panel checks access first, offers Allow access through Chrome's permission prompt, raises Chrome's own toolbar request where available, and updates as soon as access changes.
- Opened one shared side panel from the To SharePoint shortcut instead of a separate panel for the Confluence tab, so a capture made beside Confluence is still there beside SharePoint. Open panels in other windows re-read the capture when shown or when another panel changes it.
- Listed only the counts a captured page has, such as "3 tables".

## 0.2.20 - 2026-09-23 (local test build, not released)

- Renamed the extension to Confluence to SharePoint and simplified the panel around capture and import.
- Made the active-tab SharePoint destination and browser sign-in workflow explicit.
- Added provisional extension artwork while the final icon is being prepared.

## 0.2.19 - 2026-09-22

- Kept Confluence's equal and proportional table columns stable in SharePoint's reader view, and aligned table-header text and nested lists with their source layout.
- Confirmed both layout corrections in saved unpublished test drafts; audited eight saved pages visually at three scroll positions each.
- Added production extension icons, synthetic Chrome Web Store listing images, and a release package prepared for Store review.
- Re-imported two template pages with 0.2.19 and verified their saved unpublished minor drafts, list alignment, and 600/600 px two-column reader layout.

## 0.2.16 - 2026-09-22

- Preserved Confluence's native media captions on their SharePoint Image controls and reported media-border simplification explicitly.
- Converted Confluence attachment groups into stable authenticated file links while omitting card controls and timestamps.
- Confirmed multi-paragraph block tasks and their nested lists remain together as one editable checked or unchecked list item.
- Expanded the live compatibility index with explicit per-feature ADF coverage and the new controlled block-task fixture.

## 0.2.15 - 2026-09-22

- Moved the Confluence shortcut into the native page-action row so it participates in layout and cannot cover page content.
- Enabled the side panel for the current Confluence tab before accepting a shortcut click, and added a visible toolbar-icon fallback when Chrome refuses to open it.
- Added browser and background regressions for shortcut placement, tab-specific panel enablement, successful open, and visible failure feedback.

## 0.2.14 - 2026-09-22

- Preserved authored emoji and custom-panel icon text as inline Unicode inside SharePoint text and callout content without creating separate image controls.
- Converted valid Confluence inline files and media to concise linked text, while removing failed-media icons and messages that are not authored page content.
- Accepted nested Confluence renderer containers owned by one top-level article while retaining the ambiguity stop for multiple sibling article renderers.

## 0.2.13 - 2026-09-22

- Recognized Confluence's current action-item renderer (`data-task-list-local-id` and `data-task-local-id`) as well as its earlier ADF renderer hooks.
- Preserved completed and open action items as editable checked and unchecked list entries without copying Confluence checkbox controls or decorative SVGs.
- Preserved current decision items as checked or unchecked list entries using their rendered decision state.
- Added a browser regression fixture for the current Confluence action-item and decision DOM.

## 0.2.12 - 2026-09-22

- Added a page-level **Guide to SharePoint** button on Confluence documentation pages that opens the extension side panel.
- Used the current signed-in SharePoint user as the page byline when the Confluence author has no unique SharePoint match.
- Captured authored browser-rendered PNG, JPEG, GIF, and WebP pictures whose older Confluence DOM omits the original filename and MIME attributes, while retaining byte, signature, dimension, origin, and media-identity validation.

## 0.2.11 - 2026-09-22

- Accepted Confluence's verified same-page blob fallback when older rendered images omit redundant MIME, filename, and byte-size URL metadata.
- Continued validating the attachment identity, page context, media collection, browser origin, decoded MIME type, file signature, dimensions, and byte limits before capture becomes Ready.

## 0.2.10 - 2026-09-22

- Added a complete Atlassian ADF feature inventory and best-effort adapters instead of stopping on standard Confluence nodes.
- Preserved dates, mentions, status text, task lists, links, panels, column layouts, static macro content, and unknown future features when their visible content is safe.
- Omitted decorative icons while preserving emoji and icon-only semantic labels as text, avoiding SharePoint's block-like image controls inside text.
- Preserved standard Confluence info, note, tip, warning, error, success, and custom-color panels as editable colored callout tables.
- Flattened live Jira datasource widgets into their current editable SharePoint table snapshot with row links while omitting refresh, sync, and update controls.
- Omitted active embeds that have no safe static representation and retained an ordinary source link when one is available.
- Waited for declared datasource tables to render before capture and accepted SharePoint's verified CK5 HTML normalization on draft readback.

## 0.2.9 - 2026-09-22

- Replaced the duplicate document preview with a compact capture summary and conversion notes.
- Kept code blocks compact and selectable inside their surrounding native SharePoint Text controls.
- Preserved image captions on native Image controls and omitted nonfunctional Confluence Table of Contents macros.
- Continued manually numbered sequences across code blocks, pictures, captions, and continuation text while leaving isolated numbered paragraphs unchanged.
- Added a visual break between a completed list and the following top-level paragraph.
- Reduced the title metadata to the Confluence update date and retained unambiguous author mapping.
- Updated Playwright to 1.55.1 and removed the development-only security advisory present in 1.55.0.

## 0.2.8 - 2026-09-22

- Added the tested Confluence-to-unpublished-SharePoint workflow, original image capture, native page generation, attempt recovery, and tenant contract verification.
