"""Smoke-test the shipped runtime with an isolated home and no Node on PATH."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import zipfile

with tempfile.TemporaryDirectory(prefix="MDY 配对 ") as tmp:
    root = Path(tmp)
    with zipfile.ZipFile(sys.argv[1]) as archive:
        archive.extractall(root)
    folder = next(root.glob("mdy-terminal-*"))
    node = folder / "runtime" / "node.exe"
    home = root / "本机 config"
    env = {**os.environ, "XUTU_HOME": str(home), "PATH": ""}
    launcher = [os.environ["COMSPEC"], "/d", "/c", "Start-MCP.cmd", "--help"]
    assert b"--new-instance" in subprocess.check_output(launcher, cwd=folder, env=env, timeout=10)
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
                env={**env,"XUTU_PAIR_FILE":str(file)},input=line+"\n",encoding="utf-8",
                capture_output=True,check=True,timeout=15)
            assert "xutu_read" in [t["name"] for t in json.loads(result.stdout)["result"]["tools"]]
            if not suffix:
                # Keep the host stdio session open throughout an in-place upgrade.
                version = json.loads((folder / "package.json").read_text(encoding="utf-8"))["version"]
                client = subprocess.Popen([node, "mcp/stdio.mjs", "--paired"], cwd=folder,
                    env={**env, "XUTU_PAIR_FILE": str(file)}, stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE, encoding="utf-8")
                core = folder / "extension/core.js"
                original = core.read_bytes()
                def call(name):
                    client.stdin.write(json.dumps({"jsonrpc":"2.0", "id":1, "method":"tools/call",
                        "params":{"name":name,"arguments":{}}}) + "\n")
                    client.stdin.flush()
                    return json.loads(client.stdout.readline())
                try:
                    def status_version():
                        return json.loads(call("xutu_status")["result"]["content"][0]["text"])["clientVersion"]
                    assert status_version() == version
                    core.write_bytes(original.replace(version.encode(), b"99.0.0", 1))
                    assert status_version() == "99.0.0"
                    assert "VERSION_MISMATCH" in call("xutu_read")["error"]["message"]
                    core.write_bytes(original)
                    assert status_version() == version
                    saved_pair = file.read_bytes()
                    try:
                        file.write_text(json.dumps({**parsed, "clientToken":"x"*64}), encoding="utf-8")
                        assert "CREDENTIAL_MISMATCH" in call("xutu_status")["error"]["message"]
                        with socket.socket() as reserved:
                            reserved.bind(("127.0.0.1",0))
                            file.write_text(json.dumps({**parsed,"url":"http://127.0.0.1:"+str(reserved.getsockname()[1])}), encoding="utf-8")
                            assert "RELAY_OFFLINE" in call("xutu_status")["error"]["message"]
                    finally:
                        file.write_bytes(saved_pair)
                    assert status_version() == version
                finally:
                    core.write_bytes(original)
                    client.stdin.close()
                    client.wait(timeout=10)
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
