#!/usr/bin/env python3
"""Dev Pulse: dependency-free, read-only Git activity -> self-contained HTML."""
import argparse
from collections import Counter
from datetime import datetime, timedelta
import json
from pathlib import Path
import subprocess
import sys


def git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    if p.returncode:
        raise RuntimeError((p.stderr or p.stdout).strip() or "Git command failed")
    return p.stdout


def load_commits(repo, days, email):
    # Distinct explicit line header avoids depending on commit subject text.
    raw = git(repo, "log", "--no-merges", "--since=" + str(days) + " days ago",
              "--format=DEV_PULSE_COMMIT%x09%H%x09%aI%x09%ae", "--numstat")
    records = []
    record = None
    for line in raw.splitlines():
        if line.startswith("DEV_PULSE_COMMIT\t"):
            parts = line.split("\t", 3)
            if len(parts) != 4:
                record = None
                continue
            _, sha, stamp, author = parts
            record = {"sha": sha, "time": stamp, "author": author,
                      "added": 0, "deleted": 0, "files": 0}
            if author.casefold() == email.casefold():
                records.append(record)
            else:
                record = None
        elif record and "\t" in line:
            parts = line.split("\t", 2)
            if len(parts) == 3:
                a, d, _path = parts
                record["files"] += 1
                if a.isdecimal() and d.isdecimal():
                    record["added"] += int(a)
                    record["deleted"] += int(d)
    return records


def create_report(repo, email, days, commits, output):
    now = datetime.now().astimezone()
    # Time-convert author dates into local time, as promised in metrics.md.
    rows = []
    for c in commits:
        try:
            dt = datetime.fromisoformat(c["time"]).astimezone()
        except ValueError:
            continue
        rows.append({"date": dt.date().isoformat(), "hour": dt.hour,
                     "when": dt.strftime("%b %d, %Y %I:%M %p"),
                     "sha": c["sha"][:8], "added": c["added"],
                     "deleted": c["deleted"], "files": c["files"],
                     "dt": dt})
    rows.sort(key=lambda x: x["dt"], reverse=True)
    today = now.date()
    first = today - timedelta(days=days - 1)
    daymap = Counter(x["date"] for x in rows if first.isoformat() <= x["date"] <= today.isoformat())
    daily = [{"date": (first + timedelta(days=i)).isoformat(),
              "commits": daymap[(first + timedelta(days=i)).isoformat()]}
             for i in range(days)]
    in_period = [x for x in rows if first.isoformat() <= x["date"] <= today.isoformat()]
    by_hour = Counter(x["hour"] for x in in_period)
    peak = max(by_hour, key=lambda h: (by_hour[h], -h)) if by_hour else None
    payload = {
        "repo": repo.name, "email": email, "days": days,
        "generated": now.strftime("%b %d, %Y %I:%M %p %Z"),
        "commits": len(in_period), "activeDays": len(daymap),
        "added": sum(x["added"] for x in in_period),
        "deleted": sum(x["deleted"] for x in in_period),
        "last": rows[0]["when"] if rows else "No matching commits",
        "peakHour": (datetime(2000, 1, 1, peak).strftime("%I %p").lstrip("0") if peak is not None else "—"),
        "daily": daily,
        "hours": [{"hour": h, "count": by_hour[h]} for h in range(24)],
        "recent": [{k: x[k] for k in ("date", "when", "sha", "added", "deleted", "files")}
                   for x in rows[:8]],
    }
    # Escaping '<' prevents injected </script> from a repo name/email.
    data = json.dumps(payload, ensure_ascii=True).replace("<", "\\u003c")
    html = TEMPLATE.replace("__DATA__", data)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    return payload


TEMPLATE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev Pulse — local Git dashboard</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1020;color:#e8edff}
*{box-sizing:border-box}body{margin:0;padding:36px 22px;max-width:1080px;margin-inline:auto}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap}
h1{font-size:clamp(2rem,6vw,3.7rem);margin:0;letter-spacing:-.05em}h1 span{color:#8ce2cd}
.sub{color:#aab6d3;line-height:1.65}.badge{border:1px solid #455675;border-radius:20px;padding:8px 13px;color:#d2e0ff;font-size:.82rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin:28px 0}
.card,.panel{background:#151d34;border:1px solid #2c3859;border-radius:16px;padding:20px}
.label{font-size:.77rem;letter-spacing:.07em;text-transform:uppercase;color:#a8b8d8}
.value{font-size:clamp(1.5rem,3.2vw,2.3rem);font-weight:800;margin:10px 0 0;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:14px}h2{font-size:1.05rem;margin:0 0 10px}
.panel p{color:#aab6d3;font-size:.9rem;margin:0 0 18px}
#days{display:flex;gap:4px;align-items:end;min-height:145px;overflow-x:auto;padding-bottom:6px}
.bar{flex:1;min-width:5px;background:linear-gradient(#8ce2cd,#418fa8);border-radius:4px 4px 1px 1px;position:relative}
.bar.zero{background:#35425f}.bar:hover,.hour:hover{filter:brightness(1.4)}
.axis{display:flex;justify-content:space-between;color:#8092b4;font-size:.75rem;margin-top:9px}
#hours{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:5px}
.hour{border-radius:5px;min-height:27px;display:grid;place-items:center;font-size:.65rem;color:#c1d0ed}
.legend{display:flex;gap:15px;flex-wrap:wrap;margin-top:16px;color:#93a6c8;font-size:.8rem}
table{border-collapse:collapse;width:100%;font-size:.87rem}th,td{padding:11px 8px;border-bottom:1px solid #2b3755;text-align:left}th{color:#92a6c9;font-weight:500}td{color:#d5dfff}td:last-child,th:last-child{text-align:right}
.note{margin-top:18px;background:#13253b;border-left:3px solid #8ce2cd;padding:14px 17px;border-radius:5px;color:#b7cae8;font-size:.87rem;line-height:1.5}
.foot{color:#7f91b1;font-size:.78rem;margin:22px 0 0}
@media(max-width:700px){.grid{grid-template-columns:1fr}body{padding:22px 13px}.panel{padding:15px}td,th{padding:9px 4px;font-size:.75rem}}
</style></head><body>
<header><div><div class="label">A tiny love letter to your Git history</div><h1>Dev <span>Pulse</span> ⚡</h1>
<div id="subtitle" class="sub"></div></div><div class="badge">🔒 Local only · Zero dependencies</div></header>
<section class="cards">
 <div class="card"><div class="label">Commits</div><div class="value" id="commits"></div></div>
 <div class="card"><div class="label">Active days</div><div class="value" id="active"></div></div>
 <div class="card"><div class="label">Lines added</div><div class="value" id="added"></div></div>
 <div class="card"><div class="label">Lines removed</div><div class="value" id="deleted"></div></div>
</section>
<div class="grid">
<section class="panel"><h2>Your coding heartbeat</h2><p>Authored commits per local calendar day</p><div id="days" aria-label="Daily commits graph"></div><div class="axis" id="dateAxis"></div></section>
<section class="panel"><h2>Night owl or early bird?</h2><p>When your authored commits land, by local hour</p><div id="hours" aria-label="Hourly commits heatmap"></div><div class="axis"><span>12 AM</span><span>12 PM</span><span>11 PM</span></div><div class="legend"><span>🔥 Peak hour: <b id="peak"></b></span><span>🕒 Latest commit: <b id="last"></b></span></div></section>
</div>
<section class="panel" style="margin-top:14px"><h2>Recent signals</h2><p>Your last eight authored commits in this branch (within the selected Git window)</p>
<div style="overflow-x:auto"><table><thead><tr><th>When</th><th>Commit</th><th>+ Lines</th><th>− Lines</th><th>Files</th></tr></thead><tbody id="recent"></tbody></table></div></section>
<div class="note"><strong>Fun, not a performance score.</strong> Git records committed changes, not hours worked or total code written. Squashes, rebases, generated files and uncommitted edits change these numbers. No files or data are uploaded.</div>
<div class="foot" id="footer"></div>
<script id="dev-pulse-data" type="application/json">__DATA__</script>
<script>
(()=>{'use strict';const d=JSON.parse(document.getElementById('dev-pulse-data').textContent);
const el=id=>document.getElementById(id),num=n=>Number(n).toLocaleString();
el('subtitle').textContent=d.repo+' · '+d.days+'-day window · '+d.email;
el('commits').textContent=num(d.commits);el('active').textContent=num(d.activeDays)+' / '+d.days;
el('added').textContent='+'+num(d.added);el('deleted').textContent='−'+num(d.deleted);
el('peak').textContent=d.peakHour;el('last').textContent=d.last;
const max=Math.max(1,...d.daily.map(x=>x.commits));
for(const x of d.daily){const b=document.createElement('div');b.className='bar'+(x.commits?'':' zero');b.style.height=(7+138*x.commits/max)+'px';b.title=x.date+': '+x.commits+' commit(s)';b.setAttribute('aria-label',b.title);el('days').appendChild(b)}
el('dateAxis').innerHTML='<span>'+d.daily[0].date+'</span><span>'+d.daily[d.daily.length-1].date+'</span>';
const mh=Math.max(1,...d.hours.map(x=>x.count));
for(const x of d.hours){const box=document.createElement('div');box.className='hour';box.style.background='rgba(140,226,205,'+(0.1+0.85*x.count/mh)+')';box.textContent=x.hour%3===0?String(x.hour):'·';box.title=x.hour+':00 — '+x.count+' commit(s)';box.setAttribute('aria-label',box.title);el('hours').appendChild(box)}
const tbody=el('recent');for(const x of d.recent){const tr=document.createElement('tr');for(const v of [x.when,x.sha,'+'+num(x.added),'−'+num(x.deleted),num(x.files)]){const td=document.createElement('td');td.textContent=v;tr.appendChild(td)}tbody.appendChild(tr)}
if(!d.recent.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.textContent='No authored commits matched this identity and time window.';tr.appendChild(td);tbody.appendChild(tr)}
el('footer').textContent='Generated '+d.generated+' · Branch-reachable, non-merge commits only · Read-only Git analysis';
})();
</script></body></html>'''


def main():
    ap = argparse.ArgumentParser(description="Build a private, standalone Git activity dashboard")
    ap.add_argument("--repo", type=Path, default=Path.cwd(), help="Git repository path")
    ap.add_argument("--days", type=int, default=30, help="Lookback days (1–365)")
    ap.add_argument("--email", help="Override git config user.email")
    ap.add_argument("--output", type=Path, help="HTML output path (default: repo/dev-pulse.html)")
    args = ap.parse_args()
    if not 1 <= args.days <= 365:
        ap.error("--days must be between 1 and 365")
    try:
        repo = Path(git(args.repo, "rev-parse", "--show-toplevel").strip())
        email = args.email or git(repo, "config", "user.email").strip()
        if not email:
            raise RuntimeError("Git user.email is empty. Set it in Git or pass --email you@example.com")
        output = (args.output or (repo / "dev-pulse.html")).expanduser().resolve()
        data = create_report(repo, email, args.days, load_commits(repo, args.days, email), output)
        print(f"✓ Dev Pulse saved: {output}\n  Commits: {data['commits']} | Active days: {data['activeDays']} | +{data['added']} / -{data['deleted']} lines\n  Open the HTML file in your browser. No server or packages required.")
    except (OSError, RuntimeError) as exc:
        print("Dev Pulse: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
