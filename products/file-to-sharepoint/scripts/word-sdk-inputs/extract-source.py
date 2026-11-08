"""Extract a hash-verified SDK source tar, preserving Unicode source names.

The SDK archives contain regular files/directories only. Python's data filter
confines extraction after removing the common top-level Git archive prefix.
"""
from pathlib import Path, PurePosixPath
import sys
import tarfile

destination = Path(sys.argv[2]).resolve()
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive:
        parts = PurePosixPath(member.name).parts
        if member.name.startswith("/") or ".." in parts or not (member.isfile() or member.isdir()):
            raise ValueError("Unexpected SDK archive member")
        if len(parts) > 1:
            archive.extract(member.replace(name=str(PurePosixPath(*parts[1:]))), destination, filter="data")
