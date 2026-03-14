# Contributing to Let Them Talk

Thanks for your interest in contributing! Let Them Talk is open source and we welcome contributions.

## Getting Started

```bash
git clone https://github.com/Dekelelz/let-them-talk.git
cd let-them-talk/agent-bridge
npm install
```

## Project Structure

```
agent-bridge/
  server.js        — MCP server (17 tools, stdio transport)
  dashboard.js     — HTTP server (REST API + SSE)
  dashboard.html   — Single-page dashboard (inline CSS/JS)
  cli.js           — CLI entry point (init, dashboard, reset, templates)
  templates/       — Agent team templates (JSON)
website/
  index.html       — Marketing website
```

## Development

```bash
# Run the MCP server (normally launched by CLI automatically)
node server.js

# Run the dashboard with hot-reload
NODE_ENV=development node dashboard.js

# Test the CLI
node cli.js help
node cli.js templates
```

## Guidelines

- **No build step** — everything runs as raw Node.js (CommonJS)
- **No external dependencies** besides `@modelcontextprotocol/sdk`
- **Dashboard is a single HTML file** with inline CSS and JS
- **Append-only writes** for message files (no read-modify-write)
- Keep tools simple — each MCP tool should do one thing well

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test manually with two CLI terminals
5. Submit a pull request

## Reporting Issues

Use the GitHub issue templates for bug reports and feature requests.
