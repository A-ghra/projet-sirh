#!/usr/bin/env python3
"""Serveur HTTP OTOMIA RH — 404 personnalisée + repli automatique si port occupé."""
import errno
import http.server
import os
import socketserver
import subprocess
import sys

BIND = os.environ.get("OTOMIA_FRONTEND_BIND", "127.0.0.1")
BASE_PORT = int(os.environ.get("OTOMIA_FRONTEND_PORT", "5500"))
MAX_ATTEMPTS = int(os.environ.get("OTOMIA_PORT_ATTEMPTS", "20"))
FREE_PORT = os.environ.get("OTOMIA_FREE_PORT", "").strip().lower() in ("1", "true", "yes")
ROOT = os.path.dirname(os.path.abspath(__file__))


class OtomiaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_error(self, code, message=None, explain=None):
        if code == 404 and os.path.isfile(os.path.join(ROOT, "404.html")):
            self.path = "/404.html"
            return super().do_GET()
        return super().send_error(code, message, explain)


class ReuseAddrTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def _port_in_use_error(exc: OSError) -> bool:
    if exc.errno in (errno.EADDRINUSE, getattr(errno, "WSAEADDRINUSE", 10048)):
        return True
    return "address already in use" in str(exc).lower()


def _try_free_port(port: int) -> bool:
    """Libère le port si OTOMIA_FREE_PORT=1 (Linux : fuser ou lsof)."""
    print(f"  OTOMIA_FREE_PORT actif — tentative de libération du port {port}...")
    try:
        result = subprocess.run(
            ["fuser", "-k", f"{port}/tcp"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            print(f"  Port {port} libéré.")
            return True
    except FileNotFoundError:
        pass

    try:
        result = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}"],
            capture_output=True,
            text=True,
            check=False,
        )
        pids = [p.strip() for p in result.stdout.splitlines() if p.strip()]
        if not pids:
            return False
        for pid in pids:
            subprocess.run(["kill", pid], capture_output=True, check=False)
        print(f"  Port {port} libéré (PID : {', '.join(pids)}).")
        return True
    except FileNotFoundError:
        print("  Impossible de libérer le port (fuser/lsof non disponible).")
    return False


def _bind_server(port: int) -> ReuseAddrTCPServer:
    return ReuseAddrTCPServer((BIND, port), OtomiaHandler)


def _find_available_port() -> tuple[ReuseAddrTCPServer, int]:
    if FREE_PORT:
        _try_free_port(BASE_PORT)

    last_error = None
    for offset in range(MAX_ATTEMPTS):
        port = BASE_PORT + offset
        try:
            return _bind_server(port), port
        except OSError as exc:
            if not _port_in_use_error(exc):
                raise
            last_error = exc
            if offset == 0:
                print(f"Port {port} déjà utilisé, tentative sur un autre port...")
            else:
                print(f"  Port {port} occupé, essai suivant...")

    raise OSError(
        errno.EADDRINUSE,
        f"Aucun port libre entre {BASE_PORT} et {BASE_PORT + MAX_ATTEMPTS - 1}",
    ) from last_error


def main() -> int:
    os.chdir(ROOT)
    try:
        httpd, port = _find_available_port()
    except OSError as exc:
        print("ERREUR : impossible de démarrer le serveur frontend.", file=sys.stderr)
        print(f"  Détail : {exc}", file=sys.stderr)
        print(
            f"  Fermez l'autre instance ou lancez : OTOMIA_FREE_PORT=1 python3 serve.py",
            file=sys.stderr,
        )
        return 1

    url = f"http://{BIND}:{port}/login.html"
    print("============================================")
    print("  OTOMIA RH — Frontend")
    print(f"  {url}")
    if port != BASE_PORT:
        print(f"  (port {BASE_PORT} occupé → port {port} utilisé)")
    print("============================================")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServeur arrêté.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
