These seven fixtures are genuine compiled native056 V2 output, original PDF
Reader011 context, actual pinned SDK serialization, and original embedded PNG
bytes. The PDFs are project-authored synthetic controls. No old V1 fixture was
upgraded by assigning unknown original flags.

Each case has `.drawings.xml`, `.layout.xml`, `.document.xml`, `.source.pdf`, and
`.json`. JSON fields are `options:{pages,pdfText,nativeTables}`, `document`, and
`media:[{resourceName,pngSha256,bytesBase64,width,height,rgbaSha256}]`, plus source,
native DOCX and private-part hashes. `manifest.json` pins every fixture/source
PDF, converter056, Reader011, SDK, and the twelve native patch source files.

Original evenOdd rules, solid RGBA, fresh normal-compositing proof, source paths,
IDs, clips, paint ordinals, and owners come from actual native V2 records. All
seven pictures retain the Before→picture→After sequence in the first of two
editable cells; Right remains text in the second cell. Sixteen meaningful source
Unicode scalars remain editable. This does not prove original cell horizontal
coordinates or exact paragraph spacing in SharePoint.

Independent MuPDF same-density source-uniform samples pass in all seven cases:
5,168–34,128 samples per case, max RGBA difference0 for opaque hole/star/curve,
or1 for alpha. The two formerly wrong holes are transparent. Encoded PNG bytes
AND full independently decoded RGBA remain exact through native DOCX→BIN media,
including actual1334×67 and2134×67 assets. The4267px control refuses rather than
resizing to4096/2000/1200 and declaring192dpi.

The actual SDK imports native CImage objects with stable docPr IDs and the real
resource names. `sdk-extent-codec-proof.json` records public image.recalculate()
and getXfrmExtX/Y results. The serialized model is unchanged by that QA probe.
Raw graphic.extX/extY before layout are0; production uses spPr.xfrm extents.

Derived native extent codec is directional: idealEMU=pixels×914400/192. Positive
C++ casts truncate. Use floor(ideal), or floor(ideal)−1 only when ideal is an
integer and floating subtraction/multiplication lands infinitesimally below it.
The2134px width is10163174 vs ideal10163175; the67px height is319087 vs319087.5.
Both ±2EMU mutations are rejected by this codec. A symmetric ±1 bound would
incorrectly accept +2 from the2134px native baseline. This is the source-specific
derived codec, not a general image transform tolerance.

Browser canvas readback can change straight alpha through premultiplication.
Do not compare raw PNG RGBA hashes to canvas getImageData. Consumer resource
checks use exact encoded bytes plus actual decoded dimensions. The separate
native transport proof establishes raw decoded RGBA identity without custom
unpremultiplication or color corrections.

Native056 is a reviewed QA candidate built incrementally from verified055;
this fixture set does not assert adopted runtime, clean release reproduction,
complete175-PDF support, global flow, under-text composition, or SharePoint
fidelity. Root owns V2 consumers, clean native integration and final acceptance.
Historical V1 cases remain historical/refusal controls until freshly regenerated
from the inputs identified in `old-positive-regeneration-map.json`.
