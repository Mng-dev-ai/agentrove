import argparse
import ctypes
import json
import os
import re
import signal
import statistics
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SCENARIOS = {
    "launch_shell": "/",
    "launch_chat": "/chat/{chat_1k}",
    "open_1k": "/",
    "open_5k": "/",
    "scroll_5k": "/chat/{chat_5k}",
    "diff": "/chat/{chat_diff}",
    "switch": "/",
    "cells_5k_plain": "/chat/{chat_5k}",
    "cells_5k_wrapped": "/chat/{chat_5k}",
    "cells_5k_trailoff": "/chat/{chat_5k}",
    "mem_fixed": "/chat/{chat_5k}",
    "mem_timed": "/chat/{chat_5k}",
}
VARIANTS = {
    "cells_5k_wrapped": "wrapped",
    "cells_5k_trailoff": "trailoff",
}
RENDERER_NAMES = {
    "wkwebview": "com.apple.WebKit.WebContent",
    "electron": "Electron Helper (Renderer)",
}
BREAKDOWN_COMMANDS = (
    ("footprint", ["sudo", "-n", "footprint"]),
    ("vmmap", ["sudo", "-n", "vmmap", "--summary"]),
)
BREAKDOWN_TIMEOUT_S = 120
SIZE = r"(\d+(?:\.\d+)?) ([KMGT]?B)"
FOOTPRINT_ROW = re.compile(rf"^\s*{SIZE}\s+{SIZE}\s+{SIZE}\s+(\d+)\s+(\S.*?)\s*$")
UNITS = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4}
WIDTH = 960
HEIGHT = 640
RUN_TIMEOUT_S = 900
SAMPLE_INTERVAL_S = 0.1
SETTLE_S = 3.0
WEBKIT_MARKER = "com.apple.WebKit."
RUSAGE_INFO_V2 = 2


class RusageInfoV2(ctypes.Structure):
    _fields_ = [("ri_uuid", ctypes.c_uint8 * 16)] + [
        (name, ctypes.c_uint64)
        for name in (
            "ri_user_time",
            "ri_system_time",
            "ri_pkg_idle_wkups",
            "ri_interrupt_wkups",
            "ri_pageins",
            "ri_wired_size",
            "ri_resident_size",
            "ri_phys_footprint",
            "ri_proc_start_abstime",
            "ri_proc_exit_abstime",
            "ri_child_user_time",
            "ri_child_system_time",
            "ri_child_pkg_idle_wkups",
            "ri_child_interrupt_wkups",
            "ri_child_pageins",
            "ri_child_elapsed_abstime",
            "ri_diskio_bytesread",
            "ri_diskio_byteswritten",
        )
    ]


class ProcessSampler:
    def __init__(self) -> None:
        self.libproc = ctypes.CDLL("/usr/lib/libproc.dylib")

    def footprint(self, pid: int) -> int | None:
        info = RusageInfoV2()
        rc = self.libproc.proc_pid_rusage(pid, RUSAGE_INFO_V2, ctypes.byref(info))
        return info.ri_phys_footprint if rc == 0 else None

    @staticmethod
    def table() -> dict[int, tuple[int, int, str]]:
        out = subprocess.run(
            ["ps", "-axo", "pid=,ppid=,rss=,comm="],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        rows: dict[int, tuple[int, int, str]] = {}
        for line in out.splitlines():
            parts = line.split(None, 3)
            if len(parts) == 4:
                rows[int(parts[0])] = (int(parts[1]), int(parts[2]) * 1024, parts[3])
        return rows

    @staticmethod
    def webkit_pids(table: dict[int, tuple[int, int, str]]) -> set[int]:
        return {pid for pid, row in table.items() if WEBKIT_MARKER in row[2]}

    def host_pids(
        self,
        host: str,
        main_pid: int,
        baseline: set[int],
        table: dict[int, tuple[int, int, str]],
    ) -> list[int]:
        if host == "wkwebview":
            extra = self.webkit_pids(table) - baseline
        else:
            extra = set()
            frontier = {main_pid}
            while frontier:
                children = {p for p, row in table.items() if row[0] in frontier}
                frontier = children - extra
                extra |= children
        return [p for p in [main_pid, *sorted(extra)] if p in table]

    def sample(self, host: str, main_pid: int, baseline: set[int]) -> dict[str, Any]:
        table = self.table()
        pids = self.host_pids(host, main_pid, baseline, table)
        procs = []
        for pid in pids:
            procs.append(
                {
                    "pid": pid,
                    "name": Path(table[pid][2]).name,
                    "rss": table[pid][1],
                    "footprint": self.footprint(pid),
                }
            )
        return {
            "footprint": sum(p["footprint"] or 0 for p in procs),
            "rss": sum(p["rss"] for p in procs),
            "footprint_missing": sum(1 for p in procs if p["footprint"] is None),
            "procs": procs,
        }

    @staticmethod
    def breakdown(pid: int) -> tuple[str, str]:
        failures = []
        for tool, cmd in BREAKDOWN_COMMANDS:
            try:
                done = subprocess.run(
                    [*cmd, str(pid)],
                    capture_output=True,
                    text=True,
                    timeout=BREAKDOWN_TIMEOUT_S,
                )
            except subprocess.TimeoutExpired:
                failures.append(f"{tool}: timeout")
                continue
            if done.returncode == 0 and done.stdout.strip():
                return tool, done.stdout
            failures.append(f"{tool}: rc={done.returncode} {done.stderr.strip()}")
        return "none", "\n".join(failures)

    @staticmethod
    def footprint_categories(text: str) -> dict[str, int]:
        categories = {}
        for line in text.splitlines():
            row = FOOTPRINT_ROW.match(line)
            if row and row.group(8) != "TOTAL":
                categories[row.group(8)] = int(
                    float(row.group(1)) * UNITS[row.group(2)]
                )
        return categories


class Orchestrator:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.fixture = json.loads(args.fixture.read_text())
        self.sampler = ProcessSampler()
        self.tokens = self.login()
        self.results_path = args.out / "results.jsonl"
        self.builds = dict(b.split("=", 1) for b in args.builds)

    def login(self) -> dict[str, str]:
        body = urllib.parse.urlencode(
            {"username": self.args.email, "password": self.args.password}
        ).encode()
        request = urllib.request.Request(
            f"{self.args.api}/auth/jwt/login",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read())

    def command(self, host: str) -> list[str]:
        if host == "wkwebview":
            return [str(self.args.wkhost)]
        return [str(self.args.electron_bin), str(self.args.electron_app)]

    def bench_config(
        self,
        host: str,
        scenario: str,
        build: str,
        run: int,
        t0: float,
        screenshot: bool,
    ) -> dict[str, Any]:
        chats = self.fixture["chats"]
        diff = self.fixture["sizes"]["diff"]
        return {
            "scenario": scenario,
            "host": host,
            "run": run,
            "launchId": f"{host}-{scenario}-{build}-{run}-{int(t0)}",
            "t0EpochMs": t0,
            "accessToken": self.tokens["access_token"],
            "refreshToken": self.tokens["refresh_token"],
            "variant": VARIANTS.get(scenario, "plain"),
            "build": build,
            "chats": chats,
            "diffFiles": diff["modified_files"] + diff["untracked_files"],
            "screenshot": screenshot,
        }

    def wait_gone(self, pids: list[int], timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not set(pids) & set(self.sampler.table()):
                return
            time.sleep(0.2)

    def mark(
        self, host: str, main_pid: int, baseline: set[int], out_dir: Path, name: str
    ) -> dict[str, Any]:
        sample = self.sampler.sample(host, main_pid, baseline)
        renderers = [p for p in sample["procs"] if p["name"] == RENDERER_NAMES[host]]
        target = max(renderers, key=lambda p: p["footprint"] or 0)
        tool, text = self.sampler.breakdown(target["pid"])
        (out_dir / f"breakdown-{name}.txt").write_text(text)
        return {
            "footprint": sample["footprint"],
            "procs": sample["procs"],
            "renderer_pid": target["pid"],
            "renderer_footprint": target["footprint"],
            "tool": tool,
            "categories": self.sampler.footprint_categories(text)
            if tool == "footprint"
            else {},
        }

    def run_one(self, host: str, scenario: str, run: int) -> dict[str, Any]:
        out_dir = self.args.out / "raw" / scenario / host / str(run)
        out_dir.mkdir(parents=True, exist_ok=True)
        result_file = out_dir / "result.json"
        base, _, build = scenario.partition("@")
        path = SCENARIOS[base].format(
            **{k: v["id"] for k, v in self.fixture["chats"].items()}
        )
        baseline = self.sampler.webkit_pids(self.sampler.table())
        screenshot = run == 0
        t0 = time.time() * 1000
        config = {
            "url": f"{self.builds.get(build, self.args.web)}{path}",
            "out_dir": str(out_dir),
            "width": WIDTH,
            "height": HEIGHT,
            "driver_path": str(self.args.driver),
            "bench": self.bench_config(host, base, build, run, t0, screenshot),
        }
        config_path = out_dir / "config.json"
        config_path.write_text(json.dumps(config))
        proc = subprocess.Popen(
            self.command(host),
            env={**os.environ, "BENCH_CONFIG": str(config_path)},
            stdout=(out_dir / "host.log").open("w"),
            stderr=subprocess.STDOUT,
        )
        peak = {"footprint": 0, "rss": 0}
        marks: dict[str, Any] = {}
        deadline = time.monotonic() + RUN_TIMEOUT_S
        while not result_file.exists() and time.monotonic() < deadline:
            if proc.poll() is not None:
                break
            for path in sorted(out_dir.glob("mark-*")):
                name = path.name.removeprefix("mark-")
                if name not in marks:
                    marks[name] = self.mark(host, proc.pid, baseline, out_dir, name)
                    (out_dir / f"ack-{name}").touch()
            sample = self.sampler.sample(host, proc.pid, baseline)
            peak["footprint"] = max(peak["footprint"], sample["footprint"])
            peak["rss"] = max(peak["rss"], sample["rss"])
            time.sleep(SAMPLE_INTERVAL_S)
        time.sleep(0.5)
        if result_file.exists():
            result = json.loads(result_file.read_text())
        else:
            result = {"ok": False, "error": f"no result (exit={proc.poll()})"}
        time.sleep(SETTLE_S)
        settled_samples = [
            self.sampler.sample(host, proc.pid, baseline) for _ in range(5)
        ]
        if screenshot and proc.poll() is None:
            subprocess.run(
                ["screencapture", "-x", str(out_dir / "desktop.png")], check=False
            )
        pids = self.sampler.host_pids(host, proc.pid, baseline, self.sampler.table())
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        self.wait_gone(pids, 15)
        result.update(
            {
                "scenario": scenario,
                "build": build,
                "host": host,
                "run": run,
                "memory": {
                    "peak_footprint": peak["footprint"],
                    "peak_rss": peak["rss"],
                    "settled_footprint": statistics.median(
                        s["footprint"] for s in settled_samples
                    ),
                    "settled_rss": statistics.median(s["rss"] for s in settled_samples),
                    "settled_procs": settled_samples[-1]["procs"],
                    "footprint_missing": settled_samples[-1]["footprint_missing"],
                    "marks": marks,
                },
            }
        )
        with self.results_path.open("a") as fh:
            fh.write(json.dumps(result) + "\n")
        status = "ok" if result.get("ok") else f"FAIL {result.get('error')}"
        print(
            f"{scenario:13} {host:9} run {run:2} {status} "
            f"{json.dumps(result.get('metrics', {}))}",
            flush=True,
        )
        return result

    def run(self) -> None:
        for host in self.args.hosts:
            self.run_one(host, "launch_shell", -1)
        for run in range(self.args.runs):
            scenarios = self.args.scenarios
            for scenario in scenarios if run % 2 == 0 else scenarios[::-1]:
                order = self.args.hosts
                for host in order if run % 2 == 0 else order[::-1]:
                    self.run_one(host, scenario, run)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--api", required=True)
    parser.add_argument("--web", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--driver", type=Path, required=True)
    parser.add_argument("--wkhost", type=Path, required=True)
    parser.add_argument("--electron-bin", type=Path, required=True)
    parser.add_argument("--electron-app", type=Path, required=True)
    parser.add_argument("--email", default="bench@example.com")
    parser.add_argument("--password", default="bench-password-123")
    parser.add_argument("--runs", type=int, default=12)
    parser.add_argument("--scenarios", nargs="+", default=list(SCENARIOS))
    parser.add_argument("--hosts", nargs="+", default=["wkwebview", "electron"])
    parser.add_argument("--builds", nargs="*", default=[])
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    Orchestrator(args).run()


if __name__ == "__main__":
    main()
