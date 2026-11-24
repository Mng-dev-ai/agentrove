import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from scipy.stats import mannwhitneyu

HOSTS = ("wkwebview", "electron")
MB = 1024 * 1024


def fmt(value: float | None, digits: int = 1) -> str:
    return "–" if value is None else f"{value:.{digits}f}"


def summarize(values: list[float]) -> dict[str, Any]:
    return {
        "n": len(values),
        "median": statistics.median(values) if values else None,
        "min": min(values) if values else None,
        "max": max(values) if values else None,
        "raw": [round(v, 2) for v in values],
    }


def compare(wk: list[float], el: list[float]) -> dict[str, Any]:
    out = {"wkwebview": summarize(wk), "electron": summarize(el), "p": None}
    if len(wk) >= 3 and len(el) >= 3 and (set(wk) | set(el)) != {wk[0]}:
        out["p"] = mannwhitneyu(wk, el, alternative="two-sided").pvalue
    wk_med, el_med = out["wkwebview"]["median"], out["electron"]["median"]
    out["ratio"] = wk_med / el_med if wk_med is not None and el_med else None
    return out


def load(path: Path) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line]
    return [r for r in rows if r.get("run", 0) >= 0]


def build(rows: list[dict[str, Any]]) -> dict[str, Any]:
    metrics: dict[tuple[str, str], dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    memory: dict[tuple[str, str], dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    frames: dict[str, list[dict[str, Any]]] = defaultdict(list)
    failures = []
    for row in rows:
        host, scenario = row["host"], row["scenario"]
        if not row.get("ok"):
            failures.append(
                {
                    "scenario": scenario,
                    "host": host,
                    "run": row["run"],
                    "error": row.get("error"),
                }
            )
            continue
        for name, value in row["metrics"].items():
            if value is not None:
                metrics[(scenario, name)][host].append(float(value))
        for name in ("peak_footprint", "settled_footprint"):
            memory[(scenario, name)][host].append(row["memory"][name] / MB)
        idle = row.get("details", {}).get("idle")
        if idle:
            frames[host].append(idle)
    return {
        "metrics": {
            f"{s}.{m}": compare(v["wkwebview"], v["electron"])
            for (s, m), v in metrics.items()
        },
        "memory_mb": {
            f"{s}.{m}": compare(v["wkwebview"], v["electron"])
            for (s, m), v in memory.items()
        },
        "idle_frames": {
            host: {
                "runs": len(items),
                "frames_in_1s": summarize([i["frames_in_1s"] for i in items]),
                "median_frame_ms": summarize([i["median_frame_ms"] for i in items]),
                "not_visible": sum(1 for i in items if i["visibility"] != "visible"),
                "not_focused": sum(1 for i in items if not i["has_focus"]),
            }
            for host, items in frames.items()
        },
        "failures": failures,
    }


def table(title: str, data: dict[str, Any], unit: str) -> list[str]:
    lines = [
        f"### {title}",
        "",
        f"| Metric | WKWebView median ({unit}) | Electron median ({unit}) "
        "| WK/EL | p (Mann–Whitney) | n (WK/EL) |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for key, c in data.items():
        wk, el = c["wkwebview"], c["electron"]
        lines.append(
            f"| {key} | {fmt(wk['median'])} | {fmt(el['median'])} | "
            f"{fmt(c['ratio'], 2)} | {fmt(c['p'], 4)} | {wk['n']}/{el['n']} |"
        )
    return lines + [""]


def markdown(summary: dict[str, Any], env: dict[str, Any], fixture: dict[str, Any]):
    lines = ["## WKWebView vs Electron (Chromium) on the GitHub macOS runner", ""]
    lines += ["### Environment", "", "```", json.dumps(env, indent=2), "```", ""]
    lines += ["### Fixture", "", "```", json.dumps(fixture["sizes"], indent=2), "```"]
    lines += [""]
    lines += table("Timings and frame metrics", summary["metrics"], "ms / count")
    lines += table("Memory, all processes of the host", summary["memory_mb"], "MB")
    lines += ["### Idle frame production (1 s rAF count before each interaction)", ""]
    lines += [
        "| Host | runs | frames/s median | min | max | not visible | not focused |"
    ]
    lines += ["|---|---:|---:|---:|---:|---:|---:|"]
    for host, f in summary["idle_frames"].items():
        s = f["frames_in_1s"]
        lines.append(
            f"| {host} | {f['runs']} | {fmt(s['median'], 0)} | {fmt(s['min'], 0)} "
            f"| {fmt(s['max'], 0)} | {f['not_visible']} | {f['not_focused']} |"
        )
    lines += ["", f"Failures: {len(summary['failures'])}", ""]
    for f in summary["failures"]:
        lines.append(f"- {f['scenario']} {f['host']} run {f['run']}: {f['error']}")
    lines += ["", "### Raw values", ""]
    for key, c in {**summary["metrics"], **summary["memory_mb"]}.items():
        for host in HOSTS:
            h = c[host]
            lines.append(
                f"- {key} {host}: min {fmt(h['min'])} max {fmt(h['max'])} raw {h['raw']}"
            )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--env", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--summary-json", type=Path, required=True)
    parser.add_argument("--markdown", type=Path, required=True)
    args = parser.parse_args()
    rows = load(args.results)
    summary = build(rows)
    env = json.loads(args.env.read_text())
    env["hosts"] = {
        host: next(r["host_info"] for r in rows if r["host"] == host and r.get("ok"))
        for host in HOSTS
        if any(r["host"] == host and r.get("ok") for r in rows)
    }
    fixture = json.loads(args.fixture.read_text())
    args.summary_json.write_text(json.dumps({"env": env, **summary}, indent=2))
    args.markdown.write_text(markdown(summary, env, fixture))


if __name__ == "__main__":
    main()
