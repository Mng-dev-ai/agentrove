import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from scipy.stats import mannwhitneyu

HOSTS = ("wkwebview", "electron")
MB = 1024 * 1024
CELLS = "cells_5k_"
VARIANTS = ("plain", "wrapped", "trailoff")
DOM_CALLS = ("querySelector", "querySelectorAll", "getBoundingClientRect")
MARKS = ("open", "paged", "scrolled")
TOP_CATEGORIES = 10


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
    frames: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
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
        if scenario.startswith(CELLS):
            continue
        for name, value in row["metrics"].items():
            if value is not None:
                metrics[(scenario, name)][host].append(float(value))
        for name in ("peak_footprint", "settled_footprint"):
            memory[(scenario, name)][host].append(row["memory"][name] / MB)
        for key in ("idle", "idle_end"):
            idle = row.get("details", {}).get(key)
            if idle:
                frames[(key, host)].append(idle)
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
            f"{key} {host}": {
                "runs": len(items),
                "frames_in_1s": summarize([i["frames_in_1s"] for i in items]),
                "median_frame_ms": summarize([i["median_frame_ms"] for i in items]),
                "not_visible": sum(1 for i in items if i["visibility"] != "visible"),
                "not_focused": sum(1 for i in items if not i["has_focus"]),
            }
            for (key, host), items in sorted(frames.items())
        },
        "failures": failures,
    }


def med(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def cell_rows(rows: list[dict[str, Any]], variant: str) -> list[dict[str, Any]]:
    return [r for r in rows if r.get("ok") and r["scenario"] == f"{CELLS}{variant}"]


def per_frame_mean(cell: dict[str, Any], call: str, field: str) -> float:
    frames = cell["dom_per_frame"]
    return sum(f[call][field] for f in frames) / len(frames)


def cell_table(rows: list[dict[str, Any]]) -> list[str]:
    lines = [
        "### Scroll vs mounted count (cells_5k, no wrappers)",
        "",
        "Fixed px per frame: human 60, fast 460 (the old scroll_5k velocity at "
        "60 Hz, bouncing in the window). Window = last min(9000 px, max scroll "
        "- 2 viewports) of the transcript, so every cell scrolls the same newest "
        "messages. Cap 150 frames or 8 s.",
        "",
        "| Host | Speed | Mounted | fps | p95 frame (ms) | median frame (ms) "
        "| long frames (>50 ms) | frames | px travelled | elements | n |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for host in HOSTS:
        cells = [
            c
            for r in cell_rows(rows, "plain")
            if r["host"] == host
            for c in r["details"]["cells"]
        ]
        for speed in ("human", "fast"):
            for mounted in sorted({c["mounted"] for c in cells}):
                sel = [
                    c for c in cells if c["speed"] == speed and c["mounted"] == mounted
                ]
                lines.append(
                    f"| {host} | {speed} | {mounted} "
                    f"| {fmt(med([c['fps'] for c in sel]))} "
                    f"| {fmt(med([c['p95_ms'] for c in sel]))} "
                    f"| {fmt(med([c['median_ms'] for c in sel]))} "
                    f"| {fmt(med([c['long_frames'] for c in sel]), 0)} "
                    f"| {fmt(med([c['frames'] for c in sel]), 0)} "
                    f"| {fmt(med([c['travelled_px'] for c in sel]), 0)} "
                    f"| {fmt(med([c['elements'] for c in sel]), 0)} | {len(sel)} |"
                )
    return lines + [""]


def pages_by_mounted(rows: list[dict[str, Any]], host: str, variant: str):
    pages: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in cell_rows(rows, variant):
        if r["host"] == host:
            for page in r["details"]["pages"]:
                pages[page["from"]].append(page)
    return pages


def page_attribution(rows: list[dict[str, Any]]) -> list[str]:
    lines = [
        "### DOM-query attribution per history page (cells_5k)",
        "",
        "Page time = scrollTop 0 to the painted page, medians over runs. Calls and "
        "ms are the wrapped run's Element.prototype calls inside that window.",
        "",
    ]
    for host in HOSTS:
        plain = pages_by_mounted(rows, host, "plain")
        wrapped = pages_by_mounted(rows, host, "wrapped")
        lines += [
            f"#### {host}",
            "",
            "| Mounted before | page ms plain | page ms wrapped | qS calls | qS ms "
            "| qSA calls | qSA ms | gBCR calls | gBCR ms | elements after "
            "| n (plain/wrapped) |",
            "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
        for mounted in sorted(set(plain) | set(wrapped)):
            w = wrapped.get(mounted, [])
            cols = []
            for call in DOM_CALLS:
                cols.append(fmt(med([p["dom"][call]["n"] for p in w]), 0))
                cols.append(fmt(med([p["dom"][call]["ms"] for p in w])))
            lines.append(
                f"| {mounted} | {fmt(med([p['ms'] for p in plain.get(mounted, [])]))} "
                f"| {fmt(med([p['ms'] for p in w]))} | {' | '.join(cols)} "
                f"| {fmt(med([p['elements'] for p in w]), 0)} "
                f"| {len(plain.get(mounted, []))}/{len(w)} |"
            )
        lines.append("")
    return lines


def cells_for(rows: list[dict[str, Any]], host: str, variant: str):
    cells: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for r in cell_rows(rows, variant):
        if r["host"] == host:
            for c in r["details"]["cells"]:
                cells[(c["speed"], c["mounted"])].append(c)
    return cells


def frame_attribution(rows: list[dict[str, Any]]) -> list[str]:
    lines = [
        "### DOM-query attribution per scroll frame (cells_5k)",
        "",
        "Per-frame means within a run, then medians over runs. Frame times from "
        "the unwrapped and the wrapped run of the same cell.",
        "",
        "| Host | Speed | Mounted | median frame plain | median frame wrapped "
        "| fps plain | fps wrapped | qS calls/frame | qS ms/frame | qSA calls/frame "
        "| qSA ms/frame | gBCR calls/frame | gBCR ms/frame | n (plain/wrapped) |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for host in HOSTS:
        plain = cells_for(rows, host, "plain")
        wrapped = cells_for(rows, host, "wrapped")
        for key in sorted(
            set(plain) | set(wrapped), key=lambda k: (k[0] != "human", k[1])
        ):
            p, w = plain.get(key, []), wrapped.get(key, [])
            cols = []
            for call in DOM_CALLS:
                cols.append(fmt(med([per_frame_mean(c, call, "n") for c in w])))
                cols.append(fmt(med([per_frame_mean(c, call, "ms") for c in w]), 2))
            lines.append(
                f"| {host} | {key[0]} | {key[1]} "
                f"| {fmt(med([c['median_ms'] for c in p]))} "
                f"| {fmt(med([c['median_ms'] for c in w]))} "
                f"| {fmt(med([c['fps'] for c in p]))} "
                f"| {fmt(med([c['fps'] for c in w]))} "
                f"| {' | '.join(cols)} | {len(p)}/{len(w)} |"
            )
    return lines + [""]


def trail_off(rows: list[dict[str, Any]]) -> list[str]:
    lines = [
        "### Trail off (cells_5k_trailoff)",
        "",
        "Wrapped Element.prototype.querySelector returns null for "
        '`[data-message-id="` selectors on the transcript scroller after the first '
        "two in one synchronous span (reset by a microtask). Trail-off runs page "
        "20 to 320 without scrolling in between, then run the two 320 cells.",
        "",
        "| Host | Mounted before | page ms plain | page ms wrapped "
        "| page ms trail off | gBCR calls wrapped | gBCR calls trail off "
        "| n (plain/wrapped/off) |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for host in HOSTS:
        by = {v: pages_by_mounted(rows, host, v) for v in VARIANTS}
        for mounted in sorted(by["trailoff"]):
            cols = [
                fmt(med([p["ms"] for p in by[v].get(mounted, [])])) for v in VARIANTS
            ]
            calls = [
                fmt(
                    med(
                        [
                            p["dom"]["getBoundingClientRect"]["n"]
                            for p in by[v].get(mounted, [])
                        ]
                    ),
                    0,
                )
                for v in ("wrapped", "trailoff")
            ]
            n = "/".join(str(len(by[v].get(mounted, []))) for v in VARIANTS)
            lines.append(
                f"| {host} | {mounted} | {' | '.join(cols)} | {' | '.join(calls)} | {n} |"
            )
    lines += [
        "",
        "| Host | Speed (320 mounted) | Variant | fps | p95 frame (ms) "
        "| median frame (ms) | long frames | gBCR calls/frame | nulled qS/run | n |",
        "|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for host in HOSTS:
        for speed in ("human", "fast"):
            for variant in VARIANTS:
                sel = cells_for(rows, host, variant).get((speed, 320), [])
                nulled = [
                    r["details"]["trail_nulled"]
                    for r in cell_rows(rows, variant)
                    if r["host"] == host
                ]
                gbcr = (
                    fmt(
                        med(
                            [
                                per_frame_mean(c, "getBoundingClientRect", "n")
                                for c in sel
                            ]
                        )
                    )
                    if variant != "plain"
                    else "–"
                )
                lines.append(
                    f"| {host} | {speed} | {variant} "
                    f"| {fmt(med([c['fps'] for c in sel]))} "
                    f"| {fmt(med([c['p95_ms'] for c in sel]))} "
                    f"| {fmt(med([c['median_ms'] for c in sel]))} "
                    f"| {fmt(med([c['long_frames'] for c in sel]), 0)} | {gbcr} "
                    f"| {fmt(med(nulled), 0)} | {len(sel)} |"
                )
    return lines + [""]


def memory_marks(rows: list[dict[str, Any]]) -> list[str]:
    runs = [
        r
        for r in rows
        if r.get("ok") and r["scenario"] == "scroll_5k" and r["memory"].get("marks")
    ]
    lines = [
        "### Memory at three points of scroll_5k (one process per run)",
        "",
        "open = chat_5k opened (20 messages); paged = after paging to ~300 at the "
        "top; scrolled = after the 15 s scroll-through. Summed = all host "
        "processes (phys_footprint); renderer = WebContent / Electron Renderer.",
        "",
        "| Host | Point | summed MB | renderer MB | messages | elements | n |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for host in HOSTS:
        mine = [r for r in runs if r["host"] == host]
        for name in MARKS:
            sel = [r for r in mine if name in r["memory"]["marks"]]
            m = [r["memory"]["marks"][name] for r in sel]
            d = [r["details"]["marks"][name] for r in sel]
            lines.append(
                f"| {host} | {name} | {fmt(med([x['footprint'] / MB for x in m]))} "
                f"| {fmt(med([x['renderer_footprint'] / MB for x in m]))} "
                f"| {fmt(med([x['messages'] for x in d]), 0)} "
                f"| {fmt(med([x['elements'] for x in d]), 0)} | {len(sel)} |"
            )
    lines.append("")
    for host in HOSTS:
        mine = [r["memory"]["marks"] for r in runs if r["host"] == host]
        tools = sorted({m[n]["tool"] for m in mine for n in m})
        cats: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        for m in mine:
            for name in MARKS:
                for cat, size in m.get(name, {}).get("categories", {}).items():
                    cats[cat][name].append(size / MB)
        top = sorted(cats, key=lambda c: -(med(cats[c]["scrolled"]) or 0))
        lines += [
            f"#### {host} renderer, dirty MB by category (tool: {', '.join(tools)}; "
            f"top {TOP_CATEGORIES} by the scrolled point)",
            "",
            "| Category | open | paged | scrolled | n |",
            "|---|---:|---:|---:|---:|",
        ]
        for cat in top[:TOP_CATEGORIES]:
            cols = [fmt(med(cats[cat][n])) for n in MARKS]
            lines.append(
                f"| {cat} | {' | '.join(cols)} | {len(cats[cat]['scrolled'])} |"
            )
        lines.append("")
    return lines


def engine_facts(rows: list[dict[str, Any]]) -> list[str]:
    lines = ["### Engine facts", ""]
    for host in HOSTS:
        values = sorted(
            {
                str(r.get("overflow_anchor"))
                for r in rows
                if r["host"] == host and r.get("ok")
            }
        )
        lines.append(
            f"- {host}: CSS.supports('overflow-anchor', 'auto') = {', '.join(values)}"
        )
    return lines + [""]


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


def markdown(
    summary: dict[str, Any],
    env: dict[str, Any],
    fixture: dict[str, Any],
    rows: list[dict[str, Any]],
) -> str:
    lines = ["## WKWebView vs Electron (Chromium) on the GitHub macOS runner", ""]
    lines += ["### Environment", "", "```", json.dumps(env, indent=2), "```", ""]
    lines += ["### Fixture", "", "```", json.dumps(fixture["sizes"], indent=2), "```"]
    lines += [""]
    lines += table("Timings and frame metrics", summary["metrics"], "ms / count")
    lines += table("Memory, all processes of the host", summary["memory_mb"], "MB")
    lines += [
        "### Frame production check (rAF callbacks in 1 s; idle = before the "
        "interaction, idle_end = 2 s after the scenario finished)",
        "",
    ]
    lines += [
        "| Check, host | runs | frames/s median | min | max | not visible | not focused |"
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
    lines += [""]
    lines += engine_facts(rows)
    lines += page_attribution(rows)
    lines += frame_attribution(rows)
    lines += cell_table(rows)
    lines += memory_marks(rows)
    lines += trail_off(rows)
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--env", type=Path, nargs="+", required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--summary-json", type=Path, required=True)
    parser.add_argument("--markdown", type=Path, required=True)
    args = parser.parse_args()
    rows = load(args.results)
    summary = build(rows)
    envs = {path.stem: json.loads(path.read_text()) for path in args.env}
    env = next(iter(envs.values())) if len(envs) == 1 else envs
    env["hosts"] = {
        host: next(r["host_info"] for r in rows if r["host"] == host and r.get("ok"))
        for host in HOSTS
        if any(r["host"] == host and r.get("ok") for r in rows)
    }
    fixture = json.loads(args.fixture.read_text())
    args.summary_json.write_text(json.dumps({"env": env, **summary}, indent=2))
    args.markdown.write_text(markdown(summary, env, fixture, rows))


if __name__ == "__main__":
    main()
