# Contributing to Let Them Talk

Thanks for your interest in contributing! Here's how to get involved.

## Ways to Contribute

- **Bug reports** — [Open an issue](https://github.com/Dekelelz/let-them-talk/issues/new?template=bug_report.md) with steps to reproduce
- **Feature requests** — [Open an issue](https://github.com/Dekelelz/let-them-talk/issues/new?template=feature_request.md) describing the use case
- **Code** — Fork, branch, implement, open a PR
- **Templates** — Create new agent team templates (drop a JSON in `templates/`)
- **Plugins** — Build and share custom tools
- **Docs** — Fix typos, improve explanations, add examples

## Development Setup

```bash
git clone https://github.com/Dekelelz/let-them-talk.git
cd let-them-talk/agent-bridge
npm install

# Run the MCP server directly
npm start

# Run the dashboard in development mode (hot-reload)
NODE_ENV=development node dashboard.js

# Test the CLI
node cli.js help
node cli.js templates
```

## Project Structure

```
agent-bridge/
  server.js         # MCP server (27 tools + plugins)
  dashboard.js      # HTTP server (REST API + SSE)
  dashboard.html    # Single-page dashboard frontend (inline CSS/JS)
  cli.js            # CLI entry point (npx commands)
  templates/        # Agent team templates (JSON)
```

## Pull Request Guidelines

1. **One feature per PR** — keep changes focused
2. **Test your changes** — run the dashboard, test with two agents talking
3. **Update docs** — if you add a tool or feature, update the README
4. **Follow existing style** — CommonJS, no build step, no external frontend deps
5. **No breaking changes** — backward compatibility with existing `.agent-bridge/` data
6. **Append-only writes** for message files (no read-modify-write on JSONL)

## Code Style

- Raw Node.js, CommonJS (`require` / `module.exports`)
- No TypeScript, no build step, no bundler
- Dashboard is a single HTML file with inline CSS/JS
- Minimize dependencies — currently only `@modelcontextprotocol/sdk`
- Each MCP tool should do one thing well

## Adding a Template

Create a JSON file in `templates/`:

```json
{
  "name": "my-template",
  "description": "What this team configuration does",
  "agents": [
    {
      "name": "AgentName",
      "role": "What this agent does",
      "prompt": "The full prompt to paste into the terminal"
    }
  ]
}
```

Test with: `node cli.js init --template my-template`

## Adding a Plugin

See the [Plugins section](README.md#plugins) in the README. Plugins go in `.agent-bridge/plugins/` and export `name`, `description`, `inputSchema`, and `handler`.

## Reporting Issues

Use the [GitHub issue templates](https://github.com/Dekelelz/let-them-talk/issues/new/choose) for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the [Business Source License 1.1](LICENSE).
