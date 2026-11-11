"""Extract only the pinned parser build's literal source closure; build time only."""
import pathlib
import sys
import tarfile
import hashlib
import json

members = (
    "package/package.json",
    "package/src/utils.ts",
    "package/src/jsmimeparser/LICENSE",
    "package/src/jsmimeparser/mailParser.js",
    "package/src/jsmimeparser/utils.js",
    "package/src/jsmimeparser/textDecoders.js",
    "package/src/jsmimeparser/structuredHeaders.js",
    "package/src/jsmimeparser/headerParser.js",
    "package/src/jsmimeparser/rawMimeParser.js",
)
archive_path, output_path = sys.argv[1:]
output = pathlib.Path(output_path).resolve()
with tarfile.open(archive_path, "r:gz") as archive:
    inventory = archive.getmembers()
    regular = [item for item in inventory if item.isfile()]
    binary_suffixes = {".wasm", ".exe", ".dll", ".node", ".a", ".o", ".so", ".class"}
    if any(not (item.isfile() or item.isdir()) or pathlib.PurePosixPath(item.name).is_absolute() or ".." in pathlib.PurePosixPath(item.name).parts or "\\" in item.name or pathlib.PurePosixPath(item.name).suffix.lower() in binary_suffixes for item in inventory):
        raise ValueError("MIME preferred delivery contains non-source archive members")
    for name in members:
        matches = [item for item in inventory if item.name == name]
        if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 131072:
            raise ValueError("Missing, ambiguous or oversized parser source: " + name)
        target = output.joinpath(*name.split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.extractfile(matches[0]).read())
    audit = {"regularFiles": len(regular), "sourceOnly": True, "selectedSourceMembers": [{"file": name, "bytes": (output / name).stat().st_size, "sha256": hashlib.sha256((output / name).read_bytes()).hexdigest()} for name in members]}
    (output / "source-audit.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
