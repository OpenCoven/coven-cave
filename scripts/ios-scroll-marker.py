#!/usr/bin/env python3
"""Read the fixed scroll marker from exactly one selected simulator."""

import json
from pathlib import Path
import re
import subprocess
import sys

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
PREDICATE = 'process == "CovenCave" AND eventMessage CONTAINS "CAVE_SCROLL_TRACE_WRITE_ERROR"'


def query_command(udid, payload):
    if len(payload) > 1024 * 1024:
        raise ValueError("selected-device metadata exceeds the admission limit")
    metadata = json.loads(payload)
    if not isinstance(metadata, dict) or not isinstance(metadata.get("devices"), dict):
        raise ValueError("missing selected-device metadata")
    devices = []
    for rows in metadata["devices"].values():
        if not isinstance(rows, list):
            raise ValueError("invalid selected-device roster")
        devices.extend(rows)
    if len(devices) != 1 or not isinstance(devices[0], dict):
        raise ValueError("expected one exact selected simulator")
    device = devices[0]
    if not isinstance(device.get("udid"), str) or device["udid"].casefold() != udid.casefold():
        raise ValueError("device metadata does not match the selected UUID")
    state = device.get("state")
    if state == "Booted":
        command = ["xcrun", "simctl", "spawn", udid, "log", "show"]
    elif state == "Shutdown":
        raw = device.get("dataPath")
        if not isinstance(raw, str):
            raise ValueError("missing selected-device data directory")
        data = Path(raw)
        if not data.is_absolute() or data.name != "data" or data.parent.name.casefold() != udid.casefold():
            raise ValueError("data directory does not belong to the selected UUID")
        expected_data = data.parent.parent.resolve(strict=True) / data.parent.name / "data"
        data = data.resolve(strict=True)
        if data != expected_data:
            raise ValueError("selected-device data directory is redirected")
        if not data.is_dir() or data.name != "data" or data.parent.name.casefold() != udid.casefold():
            raise ValueError("resolved data directory does not match the selected UUID")
        expected_store = data / "var/db/diagnostics"
        store = expected_store.resolve(strict=True)
        if store != expected_store or not store.is_dir() or not store.is_relative_to(data):
            raise ValueError("log store is redirected or escapes the selected-device data directory")
        command = ["xcrun", "--sdk", "macosx", "log", "show", "--directory", str(store)]
    else:
        raise ValueError("selected simulator state is uncertain; collection is incomplete")
    return command + ["--style", "compact", "--last", "70m", "--predicate", PREDICATE]


def main(argv):
    if len(argv) != 1 or not UUID.fullmatch(argv[0]):
        raise ValueError("expected one selected simulator UUID")
    udid = argv[0]
    # The existing native-command owner bounds discovery and reading together,
    # and owns both child commands during timeout/interruption shutdown.
    metadata = subprocess.run(["xcrun", "simctl", "list", "devices", udid, "--json"], stdout=subprocess.PIPE)
    if metadata.returncode:
        print(f"Marker discovery exit: {metadata.returncode}", flush=True)
        return metadata.returncode
    command = query_command(udid, metadata.stdout)
    print("Marker reader: " + json.dumps({"selectedUUID": udid, "command": command}), flush=True)
    result = subprocess.run(command)
    print(f"Marker reader exit: {result.returncode}", flush=True)
    return result.returncode


if __name__ == "__main__":
    try:
        status = main(sys.argv[1:])
    except (ValueError, OSError) as error:
        print(f"Marker collection incomplete: {error}", file=sys.stderr)
        status = 2
    raise SystemExit(status)
