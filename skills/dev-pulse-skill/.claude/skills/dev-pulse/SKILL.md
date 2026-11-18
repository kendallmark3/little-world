---
name: dev-pulse
description: Generate a playful, private, interactive HTML dashboard of your own Git commit activity in the current repository. Use when someone asks for developer stats, coding pulse, contribution history, or a fun repo visualization.
argument-hint: "[--days 30]"
allowed-tools: Bash(python3 *), Bash(git *)
---

# Dev Pulse — your local coding heartbeat

## Intent
Help the developer explore their **own local Git history**, visually and without a service, signup, API key, MCP server, or Python package installation.

## Inputs and scope
- Run from the **repository root** (or pass `--repo PATH`).
- Use the `user.email` from the **local repository Git configuration** to select authored commits. Respect `--email` if the developer explicitly supplies it.
- Scope is the current checked-out branch's reachable, **non-merge commits** from the past 30 days by default.
- If identity is missing or there is no matching history, explain why; do not fabricate statistics.

## Execution
1. Run `python3 .claude/skills/dev-pulse/scripts/dev_pulse.py` from the repository root. (On Windows, use `py -3` instead of `python3`.)
2. If a different period is requested, add `--days N` (1–365).
3. Report the generated path and offer to open `dev-pulse.html` in a browser. **Do not claim the browser opened unless it actually did.**
4. Explain that additions/deletions come from committed `git --numstat` changes: they are **not** keystrokes, effort, productivity, or all uncommitted work.

## Safety and boundaries
- Read-only Git commands; never stage, modify, commit, push, fetch, or upload repository data.
- Writes only the report file at `--output` (default `dev-pulse.html` in repo root), and does not overwrite another file by default except that named report.
- No network calls, telemetry, cookies, CDNs, or third-party packages.
- Do not use the numbers to rank developers or judge performance.
- No automatic remediation, retries, or agents. One bounded pass and stop.

## Success criteria
A self-contained HTML dashboard opens locally and shows honest, attributed Git activity, or the command exits with an actionable error message.

For measurement limitations, see [references/metrics.md](references/metrics.md).
