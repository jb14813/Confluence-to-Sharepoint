# Imported document form runtime

This is a browser-executed SharePoint Framework web part for the **File to SharePoint** importer. Conversion does not run here. Text, multiline text, boolean checkboxes, dropdowns and grouped radio choices are rendered with the MIT SurveyJS Form Library; Survey Creator is not used. All executable dependencies and CSS are bundled locally. Source PDF scripts/actions are outside the accepted contract and cannot be passed to SurveyJS.

The solution was generated with Microsoft's `@microsoft/generator-sharepoint@1.24.1` and is packaged by the supported Heft `package-solution` task. An explicitly authorized lab installation and real response tests completed on 2026-11-08; see [lab acceptance](../VALIDATION.md).

## Build and validate

Use a Node version in `package.json`'s supported range. Development verification used Node 26.12.1 on Windows.

```powershell
npm ci
npm test
npm run test:browser
npm run build
```

`npm test` builds the portable entry points and runs the full owned Node test suite. It exercises the actual SurveyJS renderer in jsdom and an injected SharePoint REST transport. The browser command launches an isolated headless installed Chrome through Playwright; it uses no existing profile or CDP connection, blocks external requests and operates actual controls by keyboard. Its screenshot/report are `.artifacts/form-runtime.png` and `.artifacts/browser-smoke.json`. RED and GREEN development logs are in the ignored `.artifacts` directory. Heft's separate Jest runner currently has no suites; the Node suite above is the runtime test suite.

`npm run build` runs that suite, the SPFx production compile/lint/bundle and Microsoft's package validation. Deployable output: `sharepoint/solution/file-to-sharepoint-form.sppkg`. The package includes client-side assets and does not request extra API permissions. It declares `skipFeatureDeployment: false`, requiring the app to be installed on the selected site. The component ID is **f104fa11-c9e8-43d6-8c5a-3f7b70f31ab1**.

## Portable preview integration

Source entry: `src/runtime/index.ts`; built ESM entry: `dist/portable-form.js`; stylesheet: `dist/portable-form.css`. Both must be packaged with the importer; do not load dependencies from a CDN. `dist/sharepoint-adapter.js` is a separate portable REST adapter.

```javascript
import { mountForm, validateDefinition } from './portable-form.js';
const form = mountForm(container, validateDefinition(definition), {
  submit: async payload => {
    // Preview may inspect payload locally. A real submission must obtain
    // an explicit persisted response acknowledgement from the adapter.
    return adapter.submit(payload);
  }
});
// form.model is SurveyJS's model; form.getValues(), form.submit(), form.dispose().
```

The input is exactly the version-1 canonical importer definition. The source hash `id` is 64 lowercase hex characters; each safe field `id` is `f_` plus 16 lowercase hex characters. `sourceName` stays data and is never used as an object key. Unsupported properties/types, duplicate IDs/options, bad defaults and invalid geometry fail before rendering. Definitions retain geometry and checkbox export values. Fields are presented in boxed page groups; they are not overlaid at exact PDF coordinates.

The callback receives `{formId, definitionVersion:1, submissionId:<UUID>, values:{[fieldId]:string|boolean}}` and must return `{status:'saved', submissionId:<same UUID>}`. Required checks include unchecked required checkboxes. Read-only defaults cannot be changed through submission. Source values and submission ID remain in the mounted form after a failed/uncertain write; inputs are locked to that snapshot and only an explicit retry can resubmit it. There is no automatic retry. This pending state is memory-only and is lost if the page closes/reloads; do not close an uncertain submission before reviewing its SharePoint response record.

## Required lists on the selected site

Provision two generic SharePoint lists (template 100) only after the user reviews the import. The runtime never creates lists, changes permissions, or writes to an external site. Use these **internal** field names:

| List | Field | SharePoint type and constraints |
| --- | --- | --- |
| Definitions | Title | Default text field, title truncated to 255 characters |
| Definitions | FormId | Text, required, max 64, indexed, unique |
| Definitions | DefinitionJson | Note, required, plain text, AppendOnly=false |
| Responses | Title | Default text field, submission UUID |
| Responses | SubmissionId | Text, required, max 36, indexed, unique |
| Responses | FormId | Text, required, max 64, indexed |
| Responses | DefinitionVersion | Number, required, zero decimal places |
| Responses | ResponseJson | Note, required, plain text, AppendOnly=false |

The unique `SubmissionId` constraint is mandatory for concurrency-safe nonce checks. Definition and response JSON each have a 63,999-character maximum and oversized data is rejected before writing. The adapter checks an existing nonce before inserting, reconciles ambiguous POST outcomes with a read, and compares the entire persisted payload before accepting a prior submission. A successful HTTP status with no created item is not treated as confirmed success.

Readers need permission to read definitions. Respondents need permission to add responses **and read their own response records** for confirmation. Existing list item permissions remain authoritative; use the site's ordinary configuration to restrict other users' responses. The runtime does not request elevated/app-only access or grant ACLs. SharePoint's normal Author/Created fields record the current user. Imported definitions should be editable only by authorized importers/owners. Validation here is client-side; it is not a server-side enforcement service for direct REST/list edits.

`src/runtime/sharepoint.ts` exposes `createSharePointAdapter({webUrl,definitionListId,responseListId,request})`, returning `loadDefinition(formId)`, `saveDefinition(definition)`, and `submit(payload)`. An existing definition is immutable for a given ID; a different definition under the same ID fails. Production `src/runtime/spHttpClient.ts` wraps the current user's SPFx `SPHttpClient`, using `context.pageContext.web.absoluteUrl`. The web part properties are only `formId`, `definitionListId`, and `responseListId`; neither a URL nor arbitrary SurveyJS JSON is accepted from a document.

## Deployment review and limits

This package is prepared for review for a selected lab site. Deployment requires explicit authorization for the exact package and destination. An administrator must review the `.sppkg`, deploy it through the approved tenant or site app catalog, and then install the app on that selected site. `skipFeatureDeployment: false` requires site app installation and does not offer tenant-wide automatic availability. The prepared package alone grants no authorization to upload it, deploy it, or install it on other sites.

All intended readers, including external guests, also need access to this solution's deployed JavaScript assets. Component discovery alone does not prove that asset access. Keep grants scoped to the intended audience and this solution; the extension never changes catalog or list permissions. For scripts served directly from the same SharePoint origin, readiness checks the current account's access on every Send and refuses HTML sign-in/access-denied responses before any form setup. Public CDN script loading remains managed by SPFx.

After authorized installation, verify that the approved component ID appears in the selected web's `GetClientSideWebParts` response. Before importing a form, the extension verifies that component and the list schema, prepares the immutable definition after the user's reviewed Send action, and references it from the unpublished page's component properties. The separate importer may create its owned lists or finish missing required columns on verified-empty owned lists; it refuses incompatible schemas and partial lists containing records. List permissions remain unchanged. The web part itself never provisions lists.

The runtime itself performs no app-catalog operations. Authorized lab deployment, current-user response writes, retry reconciliation and unpublished-page integration passed on 2026-11-08; see [lab acceptance](../VALIDATION.md). Other tenants, site audiences and permission policies still require their own acceptance. The developer website is `https://jzbapps.com`; unknown privacy and terms URLs remain empty.

Supported controls use original extracted metadata; this runtime does not add XFA, PDF JavaScript, calculations, signatures, multiselect dropdowns, arbitrary SurveyJS extensions, or exact positioned PDF form overlays. Pending values are not persisted in browser storage. Definitions are limited to 500 fields and 500 choices per choice/radio field, subject to the list JSON limit.

## Provenance

SurveyJS `survey-core` and `survey-js-ui` are pinned to **3.2.4** in the owned lockfile, including npm integrity hashes. The MIT notice is preserved in `SURVEYJS-LICENSE.txt` and generated JavaScript notices. The portable builder rejects remote CSS dependencies. SurveyJS UI bundles its maintained Preact implementation. The SPFx solution uses pinned **1.24.1** Microsoft dependencies and the generated Heft configuration. This component's source is AGPL-3.0-only as part of the new importer product; existing shared-core MIT attributions remain with their source.

Sources: [Microsoft SPFx Heft toolchain](https://learn.microsoft.com/sharepoint/dev/spfx/toolchain/sharepoint-framework-toolchain-rushstack-heft), [SurveyJS Form Library](https://surveyjs.io/form-library/documentation/overview), [pinned SurveyJS license](https://github.com/surveyjs/survey-library/blob/v3.2.4/LICENSE), [Microsoft column limits](https://support.microsoft.com/en-us/sharepoint/lists/data-and-lists/list-and-library-column-types-and-options).
