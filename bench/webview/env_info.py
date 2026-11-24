import json
import subprocess
import sys
from pathlib import Path


def sh(cmd: str) -> str:
    return subprocess.run(
        cmd, shell=True, capture_output=True, text=True
    ).stdout.strip()


def labelled(text: str) -> list[str]:
    return [
        line.strip()
        for line in text.splitlines()
        if ":" in line and "Serial" not in line and "UUID" not in line
    ]


def main() -> None:
    bench_dir = Path(__file__).resolve().parent
    electron_pkg = bench_dir / "electron/node_modules/electron/package.json"
    info = {
        "macos": f"{sh('sw_vers -productVersion')} ({sh('sw_vers -buildVersion')})",
        "hardware_model": sh("sysctl -n hw.model"),
        "cpu": sh("sysctl -n machdep.cpu.brand_string"),
        "cpus": sh("sysctl -n hw.ncpu"),
        "memory_bytes": sh("sysctl -n hw.memsize"),
        "hardware_overview": labelled(sh("system_profiler SPHardwareDataType")),
        "displays": labelled(sh("system_profiler SPDisplaysDataType")),
        "safari": sh(
            "defaults read /Applications/Safari.app/Contents/Info.plist "
            "CFBundleShortVersionString"
        ),
        "webkit_framework": sh(
            "defaults read /System/Library/Frameworks/WebKit.framework/Resources/"
            "Info.plist CFBundleVersion"
        ),
        "xcode": " ".join(sh("xcodebuild -version").splitlines()),
        "electron_package": json.loads(electron_pkg.read_text())["version"],
    }
    Path(sys.argv[1]).write_text(json.dumps(info, indent=2))
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    main()
