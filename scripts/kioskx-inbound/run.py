#!/usr/bin/env python3
"""Provision the closed role/reserved identity using the existing server image."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
LOGIN = Path('/Users/macairm3/astra-work/twenty-kioskx-inbound-LOGIN.txt')

def main():
    if LOGIN.exists():
        if LOGIN.is_symlink() or LOGIN.stat().st_mode & 0o077:
            raise RuntimeError('Credential file must be a private regular file (0600)')
        credentials = json.loads(LOGIN.read_text())
    else:
        credentials = {
            'email': 'inbound.' + secrets.token_hex(6) + '@kiosk-x.ai',
            'password': secrets.token_urlsafe(32),
            'status': 'Reserved, disabled. Desk acceptance has not passed.',
        }
        descriptor = os.open(LOGIN, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as file:
            json.dump(credentials, file, indent=2)
            file.write('\n')
    # All secrets travel over stdin, never command-line arguments, logs or files
    # in the container. Neither APP_SECRET nor TWENTY_API_KEY leaves the server.
    code = ('globalThis.inboundCredentials=' + json.dumps(credentials) + ';\n'
            + 'globalThis.inboundPolicy=(()=>{const module={exports:{}};\n'
            + (ROOT / 'policy.cjs').read_text() + '\nreturn module.exports;})();\n'
            + (ROOT / 'provision.cjs').read_text())
    result = subprocess.run(
        ['kubectl', 'exec', '-i', '-n', 'aicart', 'deploy/twenty-server', '--', 'node'],
        input=code, text=True, capture_output=True,
    )
    # Defense in depth against accidental future log statements.
    output = result.stdout + result.stderr
    for key in ('email', 'password'):
        output = output.replace(credentials[key], '[REDACTED]')
    print(output, end='')
    return result.returncode

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Setup failed; inspect prerequisites without printing credentials.', file=sys.stderr)
        sys.exit(1)
