#!/usr/bin/env python3
"""Redact fixture credentials from every ZIP member without extracting paths."""
import json
import os
import sys
import zipfile

source, target = sys.argv[1:]
secrets = [value.encode() for value in json.load(sys.stdin) if value]
with zipfile.ZipFile(source) as incoming, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as outgoing:
    for entry in incoming.infolist():
        data = incoming.read(entry)
        for secret in secrets:
            data = data.replace(secret, b"[REDACTED]")
        outgoing.writestr(entry.filename, data)
os.chmod(target, 0o600)
