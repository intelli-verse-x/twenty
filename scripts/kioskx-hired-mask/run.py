#!/usr/bin/env python3
"""Deny-only live policy; never reads a password or emits API response bodies."""
import pathlib
import subprocess
import sys

source = pathlib.Path(__file__).with_name('permissions.cjs').read_text()
result = subprocess.run(
    ['kubectl', 'exec', '-i', '-n', 'aicart', 'deploy/twenty-server', '--', 'node'],
    input=source, text=True, capture_output=True,
)
for line in result.stdout.splitlines():
    if line.startswith(('PASS:', 'FAIL:')):
        print(line)
sys.exit(result.returncode)
