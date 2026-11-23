"""Smoke-test the shipped runtime with an isolated home and no Node on PATH."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

with tempfile.TemporaryDirectory(prefix="MDY 配对 ") as tmp:
    root = Path(tmp)
    with zipfile.ZipFile(sys.argv[1]) as archive:
        archive.extractall(root)
    folder = next(root.glob("mdy-terminal-*"))
    node = folder / "runtime" / ("node.exe" if os.name == "nt" else "node")
    node.chmod(0o755)
    home = root / "本机 config"
    env = {**os.environ, "XUTU_HOME": str(home), "PATH": ""}
    guard = socket.socket()
    try:
        guard.bind(("127.0.0.1", 62924))
        guard.listen()
    except OSError:
        guard.close()  # An existing listener is also a valid conflict.
    def launch(*args):
        return subprocess.Popen([node, "mcp/start-local.mjs", *args], cwd=folder, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    children = []
    try:
        for suffix in ([], ["--new-instance"]):
            proc = launch(*suffix)
            children.append(proc)
            deadline = time.monotonic() + 15
            pattern = "instance-*/connection.json" if suffix else "connection.json"
            while not list(home.glob(pattern)):
                if proc.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("portable startup failed")
                time.sleep(0.05)
            file = next(home.glob(pattern))
            parsed = json.loads(file.read_text())
            assert parsed["url"].startswith("http://127.0.0.1:") and not parsed["url"].endswith(":62924")
            # Invoke the actual bundled stdio client, on the selected loopback port.
            line = json.dumps({"jsonrpc":"2.0","id":9,"method":"tools/list","params":{}})
            result = subprocess.run([node,"mcp/stdio.mjs","--paired"],cwd=folder,
                env={**env,"XUTU_PAIR_FILE":str(file)},input=line+"\n",text=True,
                capture_output=True,check=True,timeout=15)
            assert "xutu_read" in [t["name"] for t in json.loads(result.stdout)["result"]["tools"]]
            if not suffix:
                snapshot = file.read_bytes()
                duplicate = launch()
                try:
                    duplicate.communicate(timeout=10)
                    assert duplicate.returncode != 0 and file.read_bytes() == snapshot
                finally:
                    if duplicate.poll() is None:
                        duplicate.terminate()
                        duplicate.wait(timeout=5)
        print("PASS portable runtime, Unicode path, occupied port, existing pairing, second instance, stdio")
    finally:
        for proc in children:
            proc.terminate()
            proc.wait(timeout=10)
        guard.close()
