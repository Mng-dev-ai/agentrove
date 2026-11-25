import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class SpaHandler(SimpleHTTPRequestHandler):
    def send_head(self):  # type: ignore[no-untyped-def]
        path = Path(self.translate_path(self.path))
        if not path.exists():
            self.path = "/index.html"
        return super().send_head()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:
        pass


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    handler = functools.partial(SpaHandler, directory=str(args.dir.resolve()))
    ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
