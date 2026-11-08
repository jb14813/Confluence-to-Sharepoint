# Authorized lab acceptance - 2026-11-08

The owner authorized app-catalog setup, installation on the selected lab site and live form testing. The tenant catalog was created through SharePoint's admin experience. The reviewed package was uploaded once, downloaded and SHA-256 checked, enabled with `skipFeatureDeployment:false`, and installed only on the lab web. A read of the tenant root confirmed no installation there. No automatic tenant-wide deployment or additional API permissions were requested.

Reviewed and installed package:

- Solution: `08f7c843-f68f-43e2-9862-99478df779d6`, version `1.0.0.0`.
- Web part: `f104fa11-c9e8-43d6-8c5a-3f7b70f31ab1`.
- Package SHA-256: `17cc03b2986c51a8db1db52e67c012f49d1a2ed218edfe41f98c6d0d1dddbb14`.
- Existing current-user SharePoint sign-in; no separate conversion service or application credentials.

Three real PDF files were reconstructed inside the packaged extension, reviewed, imported and operated as native SharePoint forms. Each resulting page was independently read back as Level 2, major version 0, minor version 1, PromotedState 0, with exactly one approved form component. All remained unpublished.

| Check | Live result |
| --- | --- |
| Editable text and required checkbox | Incomplete response refused; completed values persisted and independently read back. |
| Two rapid submission clicks | One response item and one unique submission ID. |
| Dropdown and radio group | Operations export value `ops` and radio value `night` persisted correctly. |
| Read-only field | Original `LAB-008` rendered read-only and remained unchanged in the saved response. |
| Required multiline field | Edited two-line value retained its newline in the persisted response JSON. |
| Persisted response with lost confirmation | Test interception allowed the real POST to return 201, then suppressed the client response and first confirmation read. The UI retained values and submission ID. Explicit retry confirmed the same item; one persisted item with the same item ID. |
| Form storage | Three immutable definitions and three responses; all submission IDs distinct. |
| List permissions | Both newly provisioned lists inherited site permissions; no permission inheritance break or ACL grant. |

Current-user owner behavior is verified. This does not establish another user's access or another tenant's policies. Source layouts reflow into editable content and page-grouped controls; this acceptance does not claim exact PDF positioning, OCR, XFA, scripts, calculations or signatures.

Live testing exposed two compatibility bugs, both fixed with failing-before/passing-after regressions:

- SharePoint returns custom component IDs in uppercase with GUID braces; readiness now accepts that exact GUID representation and still verifies the approved manifest identity.
- Truncating a long page filename stem could leave a trailing hyphen; trimming after truncation keeps the stem valid before allocation.

Validation after those changes: **821 shared regression tests and 55 product tests passed**, zero failures/skips. Independent review accepted both fixes. Local evidence is retained under the repository's ignored `.artifacts/` folder: `catalog-lab-install-verified.json`, `lab-form-submit-result.json`, `lab-advanced-recovery-result.json`, `lab-readonly-submit-result.json`, `lab-final-evidence.json`, `lab-final-root-tests.log` and `lab-final-product-tests.log`.

This records the original lab acceptance. File import has since been integrated into the standard Confluence extension. The converter was replaced with the official CryptPad release, the Word SDK was rebuilt from pinned source, and publisher-associated PDF/font sources were collected. The combined release additionally requires its source inventory, archive verification, full regression suite and packaged-extension checks; see the root release records.
