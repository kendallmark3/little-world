# Dev Pulse ⚡ — Drop-in Claude Code skill

**No pip install, no packages, no MCP, no network.** Requires Python 3.9+ and Git.

## Install
Copy the `skills/dev-pulse` folder into your repo's `.claude/skills/dev-pulse` directory (rename the parent path, preserving `SKILL.md`, `scripts/`, and `references/`).

### Recommended layout

```text
my-repo/
  .claude/
    skills/
      dev-pulse/
        SKILL.md
        scripts/dev_pulse.py
        references/metrics.md
```

### Run directly (works even without Claude)

From your repository root:

```bash
python3 .claude/skills/dev-pulse/scripts/dev_pulse.py
```

Windows: `py -3 .claude/skills/dev-pulse/scripts/dev_pulse.py`

Then open `dev-pulse.html` in your browser. Use `--days 90` or `--email you@example.com` to change the analysis.

### Run as a Claude Code skill

Ask Claude to run `/dev-pulse`, or say “show me my Dev Pulse.” Claude Code's local project-skill discovery supports `.claude/skills/<name>/SKILL.md`.

