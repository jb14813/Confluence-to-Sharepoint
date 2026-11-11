#!/usr/bin/env python3
"""Serve upstream build-script clone/checkouts from verified source archives.

Unknown repositories fail closed. The final compiler never obtains floating
dependency code. Non-fetch operations such as git apply use the real git.
"""
import configparser
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile

SOURCE = Path("/sources")
INPUTS = json.loads((SOURCE / "inputs.json").read_text())["archives"]


def normalized(repo):
    return repo.rstrip("/").removesuffix(".git").replace("git://github.com/", "https://github.com/")


def extract(repo, destination):
    pin = next((entry for entry in INPUTS if normalized(entry.get("repository", "")) == normalized(repo)), None)
    if not pin:
        raise ValueError("Unpinned build dependency: " + repo)
    source = SOURCE / pin["file"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != pin["sha256"]:
        raise ValueError("Dependency archive pin mismatch: " + pin["file"])
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(source, "r:gz") as archive:
        for member in archive:
            parts = Path(member.name).parts
            if len(parts) <= 1:
                continue
            member = copy.copy(member)
            member.name = str(Path(*parts[1:]))
            target = (destination / member.name).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("Source member escapes its dependency directory")
            if member.issym() and not (target.parent / member.linkname).resolve().is_relative_to(destination.resolve()):
                raise ValueError("Source symlink escapes its dependency directory")
            if hasattr(tarfile, "data_filter"):
                archive.extract(member, destination, filter="data")
            else:
                archive.extract(member, destination)
    (destination / ".source-pin.json").write_text(json.dumps(pin))
    print("Pinned source:", pin["file"], "->", destination, flush=True)


args = sys.argv[1:]
if args and args[0] == "clone":
    position = next(index for index, value in enumerate(args) if value.startswith(("https://", "git://")))
    repo = args[position]
    destination = Path(args[position + 1]) if len(args) > position + 1 else Path(repo.rstrip("/").split("/")[-1].removesuffix(".git"))
    extract(repo, destination)
elif args and args[0] in ("fetch", "checkout") and Path(".source-pin.json").is_file():
    print("Pinned archive revision retained:", json.loads(Path(".source-pin.json").read_text()).get("commit"), flush=True)
elif args[:2] == ["submodule", "update"] and Path(".source-pin.json").is_file():
    modules = configparser.ConfigParser()
    modules.read(".gitmodules")
    for section in modules.sections():
        url = modules[section]["url"]
        if url.startswith("../"):
            url = "https://github.com/boostorg/" + url[3:]
        extract(url, Path(modules[section]["path"]))
elif args and args[0] == "rev-parse" and Path(".source-pin.json").is_file():
    print(json.loads(Path(".source-pin.json").read_text())["commit"])
else:
    raise SystemExit(subprocess.call(["/usr/bin/git", *args]))
