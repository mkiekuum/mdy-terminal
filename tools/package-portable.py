"""Build an offline MCP bundle from one pinned, verified Node distribution."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import stat
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
NODE = "22.23.5"
DIGESTS = {
    "win-x64.zip": "4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3",
    "win-arm64.zip": "c1856817f611738c77534efbff8a5a17990593eab24046bc8d2c23a77a160d13",
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("distribution", choices=DIGESTS)
parser.add_argument("--cache", type=Path)
args = parser.parse_args()
dist = args.distribution
platform = dist.split(".")[0]
filename = f"node-v{NODE}-{dist}"
runtime = "node.exe"
version = json.loads((ROOT / "package.json").read_text())["version"]
prefix = f"mdy-terminal-v{version}-{platform}"
output = ROOT / "dist" / (prefix + ".zip")
output.parent.mkdir(exist_ok=True)

def add(package, name, data, executable=False):
    info = zipfile.ZipInfo(prefix + "/" + name)
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
    package.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=5)

with tempfile.TemporaryDirectory() as tmp:
    archive = (args.cache or Path(tmp)) / filename
    if not archive.exists():
        archive.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"https://nodejs.org/dist/v{NODE}/{filename}", timeout=120) as response:
            with archive.open("wb") as sink:
                shutil.copyfileobj(response, sink)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != DIGESTS[dist]:
        raise ValueError("Node distribution SHA-256 mismatch: " + filename)
    source_root = f"node-v{NODE}-{platform}/"
    with zipfile.ZipFile(archive) as package:
        binary = package.read(source_root + runtime)
        license_text = package.read(source_root + "LICENSE")
    with zipfile.ZipFile(output, "w") as package:
        add(package, "runtime/" + runtime, binary, True)
        add(package, "runtime/LICENSE", license_text)
        for file in [ROOT / "LICENSE", ROOT / "package.json", ROOT / "mcp/README.md",
                     *sorted((ROOT / "mcp").glob("*.mjs")), *sorted((ROOT / "extension").glob("*.js"))]:
            add(package, file.relative_to(ROOT).as_posix(), file.read_bytes())
        launcher = '@echo off\r\ncd /d "%~dp0"\r\n"runtime\\node.exe" "mcp\\start-local.mjs" %*\r\nif errorlevel 1 pause\r\n'
        add(package, "Start-MCP.cmd", launcher)
print(output)
