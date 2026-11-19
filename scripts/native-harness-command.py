#!/usr/bin/env python3
"""Anchor one finite command in a private POSIX session until it is drained."""
import argparse
import ctypes
import errno
import json
import math
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time


def group_members(group=None):
    """Read only numeric membership/status, without launching another process."""
    group = os.getpid() if group is None else group
    members = []
    if sys.platform == "darwin":
        library = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        library.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int]
        library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        # PROC_PGRP_ONLY=2, PROC_PIDTBSDINFO=3, SZOMB=5 (Darwin SDK).
        capacity = 256
        while True:
            buffer = (ctypes.c_int * capacity)()
            ctypes.set_errno(0)
            used = library.proc_listpids(2, group, buffer, ctypes.sizeof(buffer))
            # libproc maps syscall failure to zero; absence and uncertainty
            # must remain distinct. Do not inherit errno from a previous PID.
            if used < 0 or (used == 0 and ctypes.get_errno() not in (0, errno.ESRCH)):
                raise OSError(ctypes.get_errno(), "group inventory unavailable")
            if used < ctypes.sizeof(buffer):
                break
            capacity *= 2
            if capacity > 262144:
                raise RuntimeError("group inventory exceeds admission limit")
        for pid in buffer[:used // ctypes.sizeof(ctypes.c_int)]:
            if pid <= 0 or pid == os.getpid():
                continue
            info = ctypes.create_string_buffer(256)
            ctypes.set_errno(0)
            count = library.proc_pidinfo(pid, 3, 0, info, len(info))
            if count == 0 and ctypes.get_errno() == errno.ESRCH:
                continue
            if count < 8:
                raise OSError(ctypes.get_errno(), "group member status unavailable")
            status = ctypes.c_uint32.from_buffer_copy(info.raw[4:8]).value
            if status != 5:
                members.append(pid)
    elif sys.platform.startswith("linux"):
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit() or int(entry.name) == os.getpid():
                continue
            try:
                if os.getpgid(int(entry.name)) != group:
                    continue
                raw = (entry / "stat").read_text()
            except (FileNotFoundError, ProcessLookupError):
                continue
            fields = raw[raw.rindex(")") + 2:].split()
            if int(fields[2]) == group and fields[0] not in ("Z", "X"):
                members.append(int(entry.name))
    else:
        raise RuntimeError("owned group census is unsupported")
    return members


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--timeout-seconds", required=True, type=float)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if (os.name != "posix" or os.getpgrp() != os.getpid()
            or os.getsid(0) != os.getpid() or not command
            or not math.isfinite(args.timeout_seconds) or args.timeout_seconds <= 0):
        print("Native command refused: a private live session and finite deadline are required", file=sys.stderr)
        return 125
    receipt_path = Path(args.receipt)
    with receipt_path.open("x") as handle:
        os.chmod(receipt_path, 0o600)
        handle.write("{}\n")
    started = time.monotonic()
    result = {"anchorPid": os.getpid(), "groupId": os.getpgrp(),
              "sessionId": os.getsid(0), "commandPid": None,
              "phase": "starting", "rootExitCode": None, "reason": None,
              "cleanupComplete": False, "killIssued": False, "members": []}

    def persist():
        result["elapsedSeconds"] = time.monotonic() - started
        temporary = receipt_path.with_suffix(receipt_path.suffix + ".tmp")
        temporary.write_text(json.dumps(result) + "\n")
        os.chmod(temporary, 0o600)
        temporary.replace(receipt_path)

    requested = None

    def interrupted(signum, _frame):
        nonlocal requested
        if requested is None:
            requested = "cancelled"

    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    child = None
    stopping_at = None
    selector = selectors.DefaultSelector()
    selector.register(sys.stdin, selectors.EVENT_READ)
    os.set_blocking(sys.stdin.fileno(), False)
    control = b""
    try:
        persist()
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL)
        result.update(commandPid=child.pid, phase="running")
        persist()
        while True:
            now = time.monotonic()
            if stopping_at is None:
                if now - started >= args.timeout_seconds:
                    requested = requested or "timeout"
                for _key, _events in selector.select(timeout=0):
                    chunk = os.read(sys.stdin.fileno(), 4096)
                    if not chunk:
                        requested = requested or "cancelled"
                        selector.unregister(sys.stdin)
                    else:
                        control += chunk
                        if len(control) > 4096:
                            requested = requested or "owner-error"
                        if b"\n" in control:
                            message = json.loads(control.split(b"\n", 1)[0])
                            requested = requested or (message.get("reason")
                                if message.get("reason") in ("timeout", "cancelled", "output-error")
                                else "owner-error")
                if requested:
                    stopping_at = now
                    result.update(reason=requested, phase="stopping")
                    persist()
                    # Only this executing anchor's own currently held session.
                    os.killpg(os.getpgrp(), signal.SIGTERM)
            result["rootExitCode"] = child.poll()
            members = group_members()
            result["members"] = members
            if result["rootExitCode"] is not None and not members:
                result.update(phase="finished", cleanupComplete=True)
                persist()
                if result["reason"] == "timeout":
                    return 124
                if result["reason"] == "cancelled":
                    return 130
                if result["reason"]:
                    return 125
                return result["rootExitCode"] if result["rootExitCode"] >= 0 else 128 - result["rootExitCode"]
            if stopping_at is not None and time.monotonic() - stopping_at >= 5:
                result.update(phase="kill-issued", killIssued=True,
                              shutdownElapsedSeconds=time.monotonic() - stopping_at)
                try:
                    persist()
                finally:
                    # Self is alive at this call, so its group cannot be reused.
                    os.killpg(os.getpgrp(), signal.SIGKILL)
            time.sleep(0.02)
    except Exception as error:
        result.update(reason="owner-error", phase="owner-error", error=str(error))
        try:
            persist()
        finally:
            if child is not None:
                os.killpg(os.getpgrp(), signal.SIGKILL)
        return 125
    finally:
        selector.close()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--inspect-group":
        group = int(sys.argv[2])
        if group <= 1:
            raise SystemExit(125)
        print(json.dumps(group_members(group)))
        raise SystemExit(0)
    raise SystemExit(main())
