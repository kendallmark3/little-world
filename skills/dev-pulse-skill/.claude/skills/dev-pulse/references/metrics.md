# Dev Pulse measurement notes

- Commit time uses the author timestamp (`%aI`) converted to the machine's local timezone.
- The report examines current-branch reachable, non-merge commits in the selected window.
- Only commits whose author email exactly matches the selected Git email (case-insensitive) are counted.
- Lines added/deleted come from Git `--numstat` for those commits. They can include generated files, vendored files, formatting, and repeated edits. Binary-file changes are excluded from line totals.
- An activity day is a local-calendar day with one or more matching commits, not proof of coding for the entire day.
- A clean working tree is not necessary. Uncommitted lines are not included.
- Git history may have been rebased or squashed, and author dates can be misleading. These charts are for exploration and fun, **not performance evaluation**.
