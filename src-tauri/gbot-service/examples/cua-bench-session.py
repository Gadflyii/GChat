"""Run Cua's actual task setup/evaluator through Gbot's existing SSH session."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys

WIRE = sys.stdout
sys.stdout = sys.stderr
root = Path(sys.argv[1])
sys.path.insert(0, str(root))
import cua_bench


async def rpc(method, payload):
    WIRE.write(json.dumps({"method": method, "payload": payload}) + "\n")
    WIRE.flush()
    reply = json.loads(await asyncio.to_thread(sys.stdin.readline))
    if "error" in reply:
        raise RuntimeError(reply["error"])
    return reply["ok"]


class SshSession:
    async def run_command(self, command, check=True):
        result = await rpc("guest", {"kind": "exec", "program": "/bin/sh",
                                    "args": ["-c", command], "cwd": "/tmp", "env": {}})
        if check and result["exit_code"]:
            raise RuntimeError("benchmark setup command failed")
        return result

    async def write_file(self, path, content):
        await rpc("guest", {"kind": "write", "path": path, "offset": 0,
                            "data": list(content.encode()), "truncate": True})

    async def file_exists(self, path):
        result = await rpc("guest", {"kind": "exec", "program": "/usr/bin/test",
                                    "args": ["-f", path], "cwd": "/tmp", "env": {}})
        return result["exit_code"] == 0

    async def read_file(self, path):
        result = await rpc("guest", {"kind": "exec", "program": "/bin/cat",
                                    "args": [path], "cwd": "/tmp", "env": {}})
        if result["exit_code"]:
            raise RuntimeError("benchmark evaluation read failed")
        return result["stdout"]


async def main():
    start = json.loads(await asyncio.to_thread(sys.stdin.readline))
    spec = importlib.util.spec_from_file_location(
        "hello_file_env", root / "example_tasks/hello_file_env/main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    task = module.load()[start["variant"]]
    session = SshSession()
    if not start.get("resume"):
        await module.setup(task, session)
    await rpc("ready", {"description": task.description, "metadata": task.metadata})
    rewards = await module.evaluate(task, session)
    await rpc("evaluation", {"rewards": rewards, "metadata": task.metadata,
                              "module": str(spec.origin), "framework": cua_bench.__file__})


if __name__ == "__main__":
    asyncio.run(main())
