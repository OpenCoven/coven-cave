#!/usr/bin/env python3
"""Own one native command, or freeze its evidence before artifact upload."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time


def positive(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("expected a finite positive duration")
    return number


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def run_command(args):
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        raise ValueError("a command is required after --")
    started = time.monotonic()
    child = None
    timed_out = False
    interrupted = None
    failure = None

    def interrupt(signum, _frame):
        nonlocal interrupted
        interrupted = signum

    def send_owned(signum):
        # A still-owned, unreaped child reserves the new process-group id.
        # Never signal a group after the root child's terminal state is known.
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass

    old_handlers = {s: signal.signal(s, interrupt) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        child = subprocess.Popen(command, start_new_session=True)
        deadline = time.monotonic() + args.timeout_seconds
        # Short waits observe the same child; they never retry its command.
        # Python may restart an interrupted waitpid, so cancellation is a flag.
        while interrupted is None and child.poll() is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            try:
                child.wait(timeout=min(0.1, remaining))
            except subprocess.TimeoutExpired:
                if time.monotonic() >= deadline:
                    timed_out = True
                    break
        if timed_out or interrupted is not None:
            # Finish the owned shutdown before tee/collection can begin.
            for s in old_handlers:
                signal.signal(s, signal.SIG_IGN)
            for signum, grace in ((signal.SIGINT, args.grace_seconds),
                                  (signal.SIGTERM, args.terminate_seconds),
                                  (signal.SIGKILL, args.kill_seconds)):
                if child.poll() is not None:
                    break
                send_owned(signum)
                try:
                    child.wait(timeout=grace)
                except subprocess.TimeoutExpired:
                    continue
    except OSError as error:
        failure = str(error)
    finally:
        for s, handler in old_handlers.items():
            signal.signal(s, handler)
    child_code = child.poll() if child is not None else None
    terminal = child_code is not None
    if failure:
        code = 127
    elif not terminal:
        code = 125
    elif interrupted is not None:
        code = 128 + interrupted
    elif timed_out:
        code = 124
    else:
        code = child_code if child_code >= 0 else 128 - child_code
    receipt = {"command": command, "pid": child.pid if child else None,
               "elapsedSeconds": time.monotonic() - started,
               "timedOut": timed_out, "interruptedSignal": interrupted,
               "terminal": terminal, "childExitCode": child_code,
               "exitCode": code, "failure": failure}
    write_json(Path(args.receipt), receipt)
    print("Native command receipt: " + json.dumps(receipt), flush=True)
    return code


def copy_file(source, destination, relative, issues):
    temporary = destination.with_name(destination.name + ".snapshot-tmp")
    try:
        mode = source.lstat().st_mode
        if not stat.S_ISREG(mode):
            reason = "symbolic link omitted" if stat.S_ISLNK(mode) else "non-regular file omitted"
            issues.append({"path": relative, "reason": reason})
            return None
        destination.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        digest = hashlib.sha256()
        with os.fdopen(descriptor, "rb") as incoming, temporary.open("wb") as outgoing:
            before = os.fstat(incoming.fileno())
            while True:
                chunk = incoming.read(1024 * 1024)
                if not chunk:
                    break
                outgoing.write(chunk)
                digest.update(chunk)
            after = os.fstat(incoming.fileno())
        temporary.replace(destination)
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            issues.append({"path": relative, "reason": "source changed during snapshot"})
        return {"path": relative, "sha256": digest.hexdigest(), "bytes": destination.stat().st_size}
    except OSError as error:
        issues.append({"path": relative, "reason": str(error)})
        if temporary.exists():
            temporary.unlink()
        return None


def freeze(args):
    root, output = Path(args.root), Path(args.output)
    # Existing evidence is never overwritten by a second collector invocation.
    output.mkdir(parents=True, exist_ok=False)
    manifest = {"bundles": [], "logs": [], "issues": [],
                "note": "Immutable snapshots, not a test verdict. hasInfoPlist does not prove xcresult validity."}
    logs = sorted(set(root.glob("scroll-*.log")) | set(root.glob("scroll-*.receipt.json")))
    for source in logs:
        copied = copy_file(source, output / "logs" / source.name, source.name, manifest["issues"])
        if copied:
            manifest["logs"].append(copied)
    for bundle in sorted(root.glob("scroll-*.xcresult")):
        record = {"name": bundle.name, "hasInfoPlist": False, "files": [], "issues": []}
        manifest["bundles"].append(record)
        if bundle.is_symlink() or not bundle.is_dir():
            record["issues"].append({"path": bundle.name, "reason": "result root is not a regular directory"})
            continue
        def walk_error(error):
            record["issues"].append({"path": str(error.filename), "reason": str(error)})
        for directory, directories, files in os.walk(bundle, followlinks=False, onerror=walk_error):
            base = Path(directory)
            for name in list(directories):
                if (base / name).is_symlink():
                    directories.remove(name)
                    record["issues"].append({"path": str((base / name).relative_to(bundle)), "reason": "symbolic link directory omitted"})
            for name in sorted(files):
                source = base / name
                relative = str(source.relative_to(bundle))
                copied = copy_file(source, output / "results" / bundle.name / relative, relative, record["issues"])
                if copied:
                    record["files"].append(copied)
        record["hasInfoPlist"] = (output / "results" / bundle.name / "Info.plist").is_file()
        if not record["hasInfoPlist"]:
            record["issues"].append({"path": "Info.plist", "reason": "result did not finalize; partial evidence retained"})
    if not manifest["bundles"]:
        manifest["issues"].append({"path": "scroll-*.xcresult", "reason": "no result bundles found"})
    write_json(output / "manifest.json", manifest)
    partial = bool(manifest["issues"]) or any(b["issues"] for b in manifest["bundles"])
    print("Frozen native evidence: " + json.dumps({"bundles": len(manifest["bundles"]), "logs": len(manifest["logs"]), "partial": partial}), flush=True)
    return 1 if partial else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="mode", required=True)
    native = commands.add_parser("run")
    native.add_argument("--timeout-seconds", type=positive, required=True)
    native.add_argument("--grace-seconds", type=positive, default=20)
    native.add_argument("--terminate-seconds", type=positive, default=5)
    native.add_argument("--kill-seconds", type=positive, default=5)
    native.add_argument("--receipt", required=True)
    native.add_argument("command", nargs=argparse.REMAINDER)
    collect = commands.add_parser("freeze")
    collect.add_argument("--root", required=True)
    collect.add_argument("--output", required=True)
    args = parser.parse_args()
    return run_command(args) if args.mode == "run" else freeze(args)


if __name__ == "__main__":
    sys.exit(main())
