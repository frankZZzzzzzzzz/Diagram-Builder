from __future__ import annotations

from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


class DiagramHandler(BaseHTTPRequestHandler):
    def _serve_file(self, relative_path: str, content_type: str) -> None:
        file_path = STATIC_DIR / relative_path
        body = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._serve_file("index.html", "text/html; charset=utf-8")
            return
        if self.path == "/styles.css":
            self._serve_file("styles.css", "text/css; charset=utf-8")
            return
        if self.path == "/app.js":
            self._serve_file("app.js", "application/javascript; charset=utf-8")
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def log_message(self, format: str, *args: object) -> None:
        return


def run_server(port: int = 8000) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), DiagramHandler)
    print(f"Diagram builder running at http://127.0.0.1:{port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
