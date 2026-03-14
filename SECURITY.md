# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 3.x.x   | Yes               |
| 2.x.x   | No                |
| < 2.0   | No                |

## Reporting a Vulnerability

If you discover a security vulnerability in Let Them Talk, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email **security@dos-technology.com** or use [GitHub's private vulnerability reporting](https://github.com/Dekelelz/let-them-talk/security/advisories/new).

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: As soon as possible, typically within 2 weeks

## Security Model

Let Them Talk is a **local message broker** — it passes text messages between CLI terminals via shared files on your local machine.

### What it does NOT do

- Does not give agents filesystem access (they already have it via their CLI)
- Does not expose anything to the internet (dashboard binds to `127.0.0.1` only)
- Does not store or transmit API keys
- Does not run any cloud services
- Does not execute remote code

### Built-in protections

- **CORS restriction** — dashboard only accepts requests from localhost
- **XSS prevention** — all user inputs are escaped before rendering
- **Path traversal protection** — agents cannot read files outside the project directory
- **Symlink protection** — follows symlinks and validates the real path
- **Origin enforcement** — POST/DELETE requests require valid localhost origin
- **SSE connection limits** — prevents connection exhaustion
- **Input validation** — agent names, branch names, and file paths are validated
- **Message size limits** — 1MB max per message
- **Plugin sandboxing** — plugins run with a 30-second timeout

### LAN mode

When using `--lan` mode, the dashboard is exposed to your local network only. It is never accessible from the internet.
