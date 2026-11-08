#!/usr/bin/env python3
"""Deterministic preferred-source delivery. Never extracts archive members.

Only exact independently audited member pins may be omitted. All retained
regular-file bytes must reproduce the audit's canonical SHA256 index.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import sys
import tarfile
import zlib


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest_file(file):
    h = hashlib.sha256()
    size = 0
    with open(file, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
            size += len(chunk)
    return size, h.hexdigest()


def check_pin(file, pin):
    if digest_file(file) != (pin["bytes"], pin["sha256"]):
        raise ValueError("Archive pin/hash mismatch: " + str(file))


def safe_name(name):
    parts = PurePosixPath(name).parts
    if not parts or name.startswith("/") or ".." in parts or "\\" in name:
        raise ValueError("Unsafe archive member: " + name)


def find_archive(pin, directories):
    if Path(pin["file"]).name != pin["file"]:
        raise ValueError("Unsafe archive filename")
    for directory in directories:
        candidate = Path(directory) / pin["file"]
        if candidate.is_file():
            check_pin(candidate, pin)
            return candidate
    raise ValueError("Source archive missing: " + pin["file"])


class HashReader:
    def __init__(self, stream):
        self.stream = stream
        self.hash = hashlib.sha256()

    def read(self, size=-1):
        value = self.stream.read(size)
        self.hash.update(value)
        return value


def index_hash(entries):
    return hashlib.sha256(canonical(sorted(entries, key=lambda x: x["member"]))).hexdigest()


def derive(source, output, audit):
    omitted = {entry["member"]: entry for entry in audit["removedMembers"]}
    if len(omitted) != len(audit["removedMembers"]):
        raise ValueError("Duplicate removed member")
    retained, nonregular, removed, seen = [], [], [], set()
    with tarfile.open(source, "r:gz") as upstream, open(output, "xb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as gz:
            with tarfile.open(fileobj=gz, mode="w|", format=tarfile.PAX_FORMAT) as target:
                for member in upstream:
                    safe_name(member.name)
                    if member.name in seen:
                        raise ValueError("Duplicate archive member: " + member.name)
                    seen.add(member.name)
                    if member.isfile():
                        stream = HashReader(upstream.extractfile(member))
                        if member.name in omitted:
                            while stream.read(1024 * 1024):
                                pass
                        else:
                            target.addfile(member, stream)
                        entry = {"member": member.name, "bytes": member.size, "sha256": stream.hash.hexdigest()}
                        if member.name in omitted:
                            pin = omitted[member.name]
                            if any(entry[key] != pin[key] for key in entry):
                                raise ValueError("Removed member pin mismatch: " + member.name)
                            removed.append(pin)
                        else:
                            retained.append(entry)
                    else:
                        if member.name in omitted:
                            raise ValueError("Removal pin is not a regular file")
                        target.addfile(member)
                        nonregular.append({"member": member.name, "type": member.type.decode("ascii"), "linkname": member.linkname, "mode": member.mode, "uid": member.uid, "gid": member.gid, "mtime": member.mtime})
    expected = audit["retainedRegularMemberIndexSha256"]
    if len(removed) != len(omitted) or len(retained) != audit["retainedRegularFiles"] or index_hash(retained) != expected:
        raise ValueError("Retained source index or removed member set differs from audit")
    return {"removedMembers": sorted(removed, key=lambda x: x["member"]), "retainedRegularFiles": len(retained), "retainedMemberIndexSha256": expected, "retainedNonRegularMemberIndexSha256": index_hash(nonregular)}


def verify(record, directories):
    if record.get("status") != "verified-preferred-source-delivery":
        raise ValueError("Source delivery status is not verified")
    for archive in record["archives"]:
        source = find_archive(archive["published"], directories)
        forbidden = {entry["member"] for entry in archive["removedMembers"]}
        retained, nonregular = [], []
        with tarfile.open(source, "r:gz") as tar:
            for member in tar:
                safe_name(member.name)
                if member.name in forbidden:
                    raise ValueError("Excluded object present in delivery: " + member.name)
                if member.isfile():
                    stream = HashReader(tar.extractfile(member))
                    while stream.read(1024 * 1024):
                        pass
                    retained.append({"member": member.name, "bytes": member.size, "sha256": stream.hash.hexdigest()})
                else:
                    nonregular.append({"member": member.name, "type": member.type.decode("ascii"), "linkname": member.linkname, "mode": member.mode, "uid": member.uid, "gid": member.gid, "mtime": member.mtime})
        if len(retained) != archive["retainedRegularFiles"] or index_hash(retained) != archive["retainedMemberIndexSha256"] or index_hash(nonregular) != archive["retainedNonRegularMemberIndexSha256"]:
            raise ValueError("Published retained source/metadata index differs")
        print("Verified preferred source", source.name, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify")
    parser.add_argument("--policy")
    parser.add_argument("--inputs")
    parser.add_argument("--source-dir", action="append", default=[])
    parser.add_argument("--output")
    parser.add_argument("--record")
    args = parser.parse_args()
    if args.verify:
        verify(json.loads(Path(args.verify).read_text(encoding="utf-8")), args.source_dir)
        return
    if not all([args.policy, args.inputs, args.output, args.record]):
        parser.error("--policy --inputs --output --record are required for derivation")
    policy = json.loads(Path(args.policy).read_text(encoding="utf-8-sig"))
    inputs = {pin["file"]: pin for pin in json.loads(Path(args.inputs).read_text(encoding="utf-8-sig"))["archives"]}
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    records = []
    for audit in policy["archives"]:
        upstream = inputs[audit["upstream"]["file"]]
        if any(upstream[key] != audit["upstream"][key] for key in ("file", "bytes", "sha256")):
            raise ValueError("Origin/source policy pin mismatch")
        source = find_archive(upstream, args.source_dir)
        name = upstream["file"].removesuffix(".tar.gz") + ".source-only.tar.gz"
        destination = output / name
        result = derive(source, destination, audit)
        size, sha256 = digest_file(destination)
        records.append({"upstream": {key: upstream[key] for key in ("file", "url", "bytes", "sha256")}, "published": {"file": name, "bytes": size, "sha256": sha256}, "rules": {"policyVersion": policy["policyVersion"], "selection": "exact audited member pins; all other source/data bytes and member metadata retained"}, **result})
        print("Derived", name, size, sha256, flush=True)
    script = Path(__file__)
    record = {"schemaVersion": 1, "status": "verified-preferred-source-delivery", "policy": {"file": "products/file-to-sharepoint/vendor/provenance/source-filter-policy.json", "sha256": digest_file(args.policy)[1]}, "generator": {"file": "products/file-to-sharepoint/scripts/filter-source-archives.py", "sha256": digest_file(script)[1], "python": platform.python_version(), "zlib": zlib.ZLIB_VERSION}, "archives": records}
    Path(args.record).write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    verify(record, [output])


if __name__ == "__main__":
    main()
