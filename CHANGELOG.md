# Changelog

## 0.5.1 - 2026-09-30

Fixes from a review of 0.5.0 and from its first use. Nothing changes how a page is chosen or sent.

- **The Sites view's sign-in message goes once you have signed in.** Opening the popup asks the Confluence site again, at once after a sign-in or an access grant (a site that did not answer is asked again after half a minute); it no longer takes turning the setting off and on. A site you never used, read without signing in, records no message; a failed read is worded as a read.
- **Update finds a page whose earlier version you restored in SharePoint.** The sent list keeps what this Confluence page's last eight sends wrote to the page, so an Update after a restore replaces that content instead of crossing the page off and offering a new page.
- **Keep in my Confluence account.** Turning it on removes the older "turned off" note on every Confluence site this computer has used, so a computer without Chrome sync is not turned off against your latest choice. A removal that had to wait (for instance while you were signed out) is made later only in the account that holds this computer's entries; otherwise nothing is removed there and the popup says so. A removal for a site that is gone, or has not answered for two weeks, is given up and said. Following a renamed page no longer replaces a newer update's content from another computer, a newer synced On is taken, an undated Off from another computer never turns this one off, and the "did not fit" note goes with the copy. The popup and README say where removals and the note reach: the Confluence sites this computer has sent pages from.
- **Send to offers a site whose address has ( ) ' or !** while its tab is open, and a site named "pages" takes sends. **Forget all** is offered whenever this browser holds sites or sent entries.
- **Tables keep Confluence's column proportions.** A table without stored widths (Confluence draws its columns equal) came to SharePoint with columns sized by their content, which drew a picture's column about a quarter wider than in Confluence. **A list item holding only a picture** draws its bullet or number above the picture, not below.
- **Captures keep more:** emoji in manually numbered steps; a picture whose caption holds an emoji or a link icon (it was marked not copied); a panel's icon stays out of a code block the panel starts with, and a "$" in a custom icon's text stays as written; a caption over 1,000 characters is shortened with a note instead of dropped; an SVG shown at several widths is drawn at the widest; a picture stored without a width (live docs, pages in the editor) is sized as Confluence draws it (an SVG was drawn at twice its size); a roadmap bar running past the 60 months shown is named in the note; a task list's omitted macros and mentions are counted once; a re-read lost while waiting for Confluence to save captures the copy already read.
- **Captures give up sooner and stop less:** a Confluence picture download that stops answering is given up after 30 seconds without data, then its display copy is tried, then it is marked (it held the capture for 30 minutes); pictures inside macro bodies Confluence does not show no longer cost a 15-second wait and a misleading note; following a link to a heading on the same page, or opening a comment, during a capture no longer stops it; a run of text over the extension's limit is split, and an element too large for it is left out with a note naming the limit.
- **Sends:** a check-in whose answer was lost is read back and tried once more, and the note says SharePoint did not answer in time; a check-in SharePoint accepted whose confirming read failed is reported as unconfirmed, not as left checked out; a failed draft whose naming save landed names its renamed file; picture uploads refused as too busy wait 1 and 2 seconds before trying again; Add to bottom of a 2,000-part capture is no longer refused after its pictures were uploaded.
- **After a restart of the extension during a send or an update,** a recovered update keeps a newer entry from another computer, a recovered send keeps its warnings, and the tabs kept from Chrome's memory saver are given back; the Confluence tab is kept from it during a capture; a send reuses the Site Pages tab a stopped send of the same site left open instead of opening another.
- **The sent list keeps up to 2,000 entries** within 4 MB (200 before), the oldest going first beyond that.

## 0.5.0 - 2026-09-29

What is new since 0.4.5, the previous version in the Chrome Web Store. Versions 0.4.6 to 0.4.11 were test builds, never released; their entries below give the detail.

- **Keep in my Confluence account**, a new setting in the **Sites** view, off until you turn it on, keeps the list of pages you sent where as private settings of your own account on the Confluence sites you send pages from, so **Sent to** and **Update** come back on another computer or after Chrome is reset. No server of the developer's is involved. Turning it off removes that copy; turn it off before uninstalling if you want it gone.
- **Your pinned sites, and that setting, follow Chrome sync** to your other Chrome browsers. The pins you had are kept.
- **Update finds a page renamed or moved** within its Site Pages, by the permanent ID SharePoint gives it. A deleted page is crossed off, with **Create a new page** offered. A page sent with 0.4.5 is followed this way after its next Update.
- **Pictures stay where they were:** inside numbered and bulleted steps (the numbering goes on after them), and inside table cells, panels and quotes, as SharePoint's own pictures there, with their alternative text, caption and link, at about the size Confluence shows them. A picture that cannot be copied is a link to its file, and its note says why.
- **Overwrite warns** when a page holds content sent from other Confluence pages.
- **Capture keeps more and names what it could not copy**, sends work with Site Assets libraries that require check-out, keep drafts or need approval, and there are reliability, wording and keyboard fixes.
- The extension no longer asks for access to `media-cdn.atlassian.com`, which it did not need.

## 0.4.11 - 2026-09-28 (test build, not released)

- **Pictures inside tables, panels and quotes stay in them.** A picture in a table cell, in an info, note or other panel, or in a quote was sent as a link to its file; it is now in its cell, panel or quote, as SharePoint's own picture inside text, the way SharePoint's editor places a picture there, with its alternative text, caption and link, at about the size Confluence shows it. A picture in a list inside a cell stays there too. A picture that cannot be copied is still a link, and its note now gives the reason, such as its format.

## 0.4.10 - 2026-09-28 (test build, not released)

- **Pictures inside list steps come over as pictures.** A screenshot inside a numbered or bulleted step was sent as a link to its file; it is now a SharePoint picture under its step, as pictures between paragraphs are, and the list goes on with the next number after it. Text that follows a picture inside the same step, or sub-steps after it, go on after the picture without the list's indent, with a layout note; sub-steps keep their lettering. Pictures inside tables and panels are still links.

## 0.4.9 - 2026-09-27 (test build, not released)

- **Keep in my Confluence account is one setting for all your Chrome browsers:** turning it on or off in one does the same in every Chrome signed in to your Google account with Chrome sync on. Turning it off also leaves a small note in your Confluence account, so a computer without Chrome sync turns it off as well the next time it saves or reads there, and says so in its Sites view; turning it on again removes the note.
- **Pinned sites follow Chrome sync** to your other Chrome browsers, whether or not Keep in my Confluence account is on; the Confluence copy now holds only the sent list. Pins you had before are kept. Forget all unpins them everywhere.
- A table of contents caught while it was still drawing is no longer said to be "still loading, not copied": it is left out by design, as before.

## 0.4.8 - 2026-09-27 (test build, not released)

- **A capture is kept under the page it was taken from.** Moving to another Confluence page just as a capture or Update starts now stops it, so one page's content can never be written in another page's part; a page reloaded during a capture stops it at once.
- **Pictures:** pictures a page shows from another page's attachments are copied; portrait phone photos, stored turned, are accepted; a picture's own web link is kept. In a Site Assets library that requires check-out, the pictures are checked in; where it keeps drafts or needs approval, a note says readers won't see them until they are published or approved there. A site without a usable Site Assets library gets the page without the pictures, each marked where it was, with a note, instead of stopping.
- **Capture keeps more, and says what it could not keep:** right-aligned text, a centred line under a captioned picture, pages with more pictures than their stored copy (includes, synced blocks), very large pages and many collapsed sections, nested collapsed sections, lists numbered from 0, and text with control characters are captured; formatting SharePoint refuses gets the nearest it takes. Macros still loading, frames, videos, macros an editor capture cannot copy, and pictures Confluence could only give as its display copy are named in the list of what was not copied.
- **Sending into a page:** a page you had checked out stays checked out to you, as it was. Add to bottom is refused on a page this Confluence page was sent to and that was renamed since (use its Update). An author lookup SharePoint refuses keeps the date and says so. A save SharePoint had not finished when the send stopped waiting is neither repeated nor undone, and the page is reported as possibly changed. A page SharePoint was too busy to create leaves the capture ready to send again. Sites whose address has ( ) ' or ! work.
- **The popup** keeps the keyboard on the control you used, announces refusals, says Update sends this capture (and replaces edits made to what it sent), and says Forget all removes the copy in your Confluence account too.
- **Keep in my Confluence account:** a page renamed or moved in SharePoint reaches the other computers' lists with its new address, for every Confluence page sent to it.
- A send that restarts with the extension keeps its tab its own until it ends, a very large picture's upload is waited for as long as it may take, and the previous browser session's capture is discarded when the browser starts.

## 0.4.7 - 2026-09-27 (test build, not released)

- **Keep in my Confluence account**, a new setting at the foot of the **Sites** view, off until you turn it on. It saves which Confluence pages you sent where, and your pinned sites, as private settings of your own account on the Confluence sites you send pages from (Atlassian documents that only that account can read them); no other server is involved. After Chrome is reset, or on another computer, turning it on brings **Sent to**, **Update** and the pins back as soon as the popup opens on a Confluence page. The account holds what every computer with the setting on sent, and a removal made on one reaches the others. Turning it off removes the copy from the account (turn it off on each computer, and before uninstalling); **Forget all** also turns it off.
- **Update follows a page that was renamed, or moved to a folder of its Site Pages,** by the permanent ID SharePoint gives the page, writes it at its new address, and remembers that address. A different page given the old address is never written.
- **A page or part that is gone is crossed off, and the popup offers Create a new page** (unless the Confluence page is also in another page of that site): one click sends the capture the update just made to the same site as a new draft. The advice to overwrite a renamed page, or to remove its earlier copy by hand, is gone. A page sent before 0.4.7 is known only by its address until its next successful Update, so a rename made before then cannot be followed, and the message says so.
- **Overwrite warns on a combined page:** choosing a page that holds content sent from other Confluence pages says that Overwrite removes it too.

## 0.4.6 - 2026-09-26 (test build, not released)

Housekeeping after 0.4.5; no change in what the extension does.

- The popup's styles are one file. The second stylesheet, left from the side panel the toolbar popup replaced in 0.3.0, carried rules nothing used any more.
- Messages that still called a send an "import" say "send", and the note on a picture that became a link no longer names columns, whose pictures have stayed in place since 0.3.9.
- The note under **Send to**'s **Update** says, as the note under **Sent to** does, that a page made from the Confluence page gets its title, byline and date again.
- The privacy policy and the permission texts are completed: **Update** captures the page too; on install, update or when site access is granted, the extension adds its scripts to the Confluence and SharePoint pages already open; what is stored for a remembered site, page and record is listed.

## 0.4.5 - 2026-09-26

Fixes from the completeness pass over 0.4.4; nothing new to learn.

- A send SharePoint is too busy for keeps going: the request token, the check-out, the title, the check-in and the picture uploads are sent again after the wait SharePoint asks for (HTTP 429 and 503). Before, one such answer stopped the whole send, at times after the page had been created. Page creation is still never repeated, and a page save is read back instead.
- A long or throttled send is followed to its end as long as its tab keeps reporting progress, instead of being given up after 15 minutes while it is still writing.
- If the extension is updated or restarted while a send is writing, the popup says so afterwards ("A draft may already exist" or "The page may have changed", with the review link) instead of forgetting the send.
- A draft SharePoint made before a stop is linked for review at its own address, and the message says it may be checked out to you.
- The send's background tab is kept from Chrome's memory saver while the send uses it.
- **Update** carries the look of the part's first section (background and audiences; the collapsible heading for one-section content), and the result says when a different look on another of the part's sections was not kept, or when a collapsible heading now appears twice because content was added inside the section in SharePoint.
- Up to 29 sites can be pinned, so the site last visited always stays in the list.
- After site access is granted, from the popup or from Chrome's extensions page, SharePoint pages already open are remembered at once.
- An **Update** that finds its page renamed or moved says what to do there: **Overwrite** on a page made from the Confluence page, or remove the earlier copy first and **Add to bottom** on a page the part was added to.
- Wording and the popup: a site tab that stops answering during a send no longer asks for a reload beside the review instruction, and the messages the review named lost their own instruction; "may still be checked out to you" is said only when it may be true; the **Allow site access** card no longer appears for users who granted only specific sites, and does appear when SharePoint access is withheld and a capture has nowhere to go; a closed tab is not offered to show, and the job's own report stays; the message that the popup window's tab was closed stays through a job's progress and the Sites view's actions; opening the Sites view and going back keeps the keyboard on the way back, and a refusal shown in the Sites view stays there.

## 0.4.4 - Unreleased

Fixes from a close review of 0.4.3; nothing new to learn.

- **Add to bottom** works on a page that has no title yet. SharePoint reads an empty title back as nothing at all, which the check after the save took for a change, so every such send was undone with a misleading message.
- **Update** keeps the look the part's section was given in SharePoint: its background, and its collapsible heading when the new content is one section (with several sections the heading is left out, and the result says so).
- A second click on **Create draft** (or any command refused because a send is already running) no longer hides the running send and its **Open draft** link behind "Something went wrong" until the popup is reopened.
- The note under **Update** and **Overwrite** describes those buttons; it described **Add to bottom**. The notes under **Sent to** and **Send to** say that a page made from the Confluence page gets its title, byline and date again, and that the earlier version stays in the page's history.
- Closing the tab a capture or send was using reports that in plain words, instead of Chrome's own error text, and **Show the tab** is not offered for a closed tab. A save SharePoint did not confirm, undone with the send's own check-out, says the page was put back as it was; one whose check-out could not be undone says the page may still be checked out.
- After the extension restarts during a send, the popup follows the send's remaining steps instead of keeping the step shown before the restart.
- The popup page opened in a window of its own (where Chrome cannot show the toolbar popup) follows its tab to another page and says when the tab was closed.
- Choosing a site or page with the arrow keys keeps the keyboard focus on it. **Pin** and **Unpin** name their site to screen readers, and **Remove** names a page's file when two pages share a title. A site with a problem keeps its problem text readable. A failed action in the Sites view is reported there. The header's **Sites** link is hidden while the Sites view is open. The Sites view says that removing a site or page, or **Forget all**, also forgets what was sent there.
- With Chrome's site access withheld for SharePoint, the popup asks for access instead of listing nothing under **Send to**, and never offers a send over a tab it cannot read.
- Wording: "pictures" throughout (the card said "images"); a page that was deleted, renamed or moved; a page the account cannot edit says what to do; a send that timed out no longer gives two different instructions; the note on drafts made without the Delete Items permission names the file and says the title is right; the same apostrophe everywhere.
- The package notices no longer list JSZip, which the extension has not included since the Word import was retired.

## 0.4.3 - Unreleased

- No second copy of a Confluence page by accident. On a site that already has the captured page, **Send to** offers **Update “‹page›”** instead of **Create draft**, and a page that already has it offers **Update** instead of **Add to bottom**; the background refuses the new draft or the second add as well. Sending the page into another page of the same site stays possible, since a page can be wanted in more than one place, and the popup warns that it makes a second copy.

## 0.4.2 - Unreleased

- Draws the names of sites and pages in the popup at their intended size. Chrome gives an extension's pages a smaller base font (75%), so those names showed smaller than the addresses under them.
- Pages under **Sent to** that share a title and a site, such as several pages made from one Confluence page, show their file names under the title, as **Send to** does, so each can be told apart.

## 0.4.1 - Unreleased

- **Send to** no longer lists every SharePoint site you have visited. It offers the sites you pin, always, and the other remembered sites while they're open in a tab, with a site's pages likewise while open. A site or page you choose stays listed until the popup closes. Every remembered site is still in the **Sites** view, to pin. Which tabs are open is read when the popup opens and is not stored.

## 0.4.0 - Unreleased

- Sends a capture into an existing SharePoint page, not only into a new draft. Under **Send to**, the chosen site lists the pages of it you have opened, created or sent to (up to 10, newest first; the site's home page is left out). Choosing one asks **Send to “…”?**:
  - **Add to bottom** keeps everything on the page and adds the Confluence page below it, starting with its title as a heading, so several Confluence pages can be combined into one SharePoint page.
  - **Overwrite** replaces the page's content, title, byline and date with the Confluence page's. Its banner picture and its address stay.

  The page is checked out before it is read, so nothing changes between reading and saving it, then saved, read back and checked in as a minor version. The change is an unpublished draft: readers keep the published page until you publish, and the earlier version stays in the page's version history.
- Every send ends with the page in front in its page view, where SharePoint shows you the draft with **Edit** and **Publish**. A tab already showing the page is reloaded instead of another opening. New drafts used to open in SharePoint's editor, which holds a page for about a minute after it closes and so would stop the next send to it.
- New drafts are checked in as minor versions once saved: still unpublished, and like drafts made in SharePoint's own editor, ones others can co-author. Where the library needs a required column filled in first, SharePoint keeps the draft checked out to you, and the popup says why.
- A page open in SharePoint's editor stops a send before anything happens. When it is open in this browser, **Show the tab** takes you to it. Just after you close the editor, SharePoint holds the page for about a minute; the send waits for it, saying so. Someone else editing the page, or having it checked out, stops the send with their name.
- A send that stopped without changing anything can simply be sent again, without capturing again: before the page is written for a page, or before any page is created for a draft. Pictures already uploaded are reused.
- SharePoint moving a site's Site Pages to its default view while a send starts no longer stops it with "A draft may already exist": the send now checks only that its tab stays on the site.
- Pages that share a title, such as two drafts of one Confluence page, show their file names under the title.
- Updates a SharePoint page from the Confluence page sent to it, in one click. Every send remembers, in this browser, which Confluence page went to which SharePoint page and which parts of the page it wrote. On a Confluence page sent before, the popup lists those pages under **Sent to**, each with **Update**. **Update** captures the page and puts it in place of what it sent there, as an unpublished draft:
  - On a combined page, only that Confluence page's part is replaced, where it is; the other parts, and sections and web parts added in SharePoint, stay. Changes made in SharePoint to the part itself are replaced.
  - A page made from the Confluence page also gets its title, byline and date again; an added part gets its heading again.
  - If the part is no longer on the page, nothing changes and the page leaves the list.

  SharePoint's editor keeps the identities of a page's parts when someone edits it, so the parts are found wherever they are. **Overwrite** replaces everything on a page, so the other Confluence pages sent to it leave its list. Removing a site or page in the **Sites** view, or **Forget all**, also forgets what was sent to it.

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
