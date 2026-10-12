"""Private ComputerAgent process; the service owns credentials, effects and recovery."""
import asyncio
import json
import sys

WIRE = sys.stdout
sys.stdout = sys.stderr

from cua_agent import ComputerAgent
from cua_agent.callbacks.base import AsyncCallbackHandler
from cua_agent.loops.ginfer import GInferConfig, from_chat_messages, to_chat_messages
from cua_agent.tools.base import BaseTool


async def rpc(method, payload):
    WIRE.write(json.dumps({"method": method, "payload": payload}) + "\n")
    WIRE.flush()
    line = await asyncio.to_thread(sys.stdin.readline)
    if not line:
        raise RuntimeError("Gbot service disconnected")
    reply = json.loads(line)
    if "error" in reply:
        raise RuntimeError(reply["error"])
    return reply["ok"]


class Callbacks(AsyncCallbackHandler):
    def __init__(self):
        self.call_id = None

    async def on_llm_start(self, messages):
        prepared = await rpc("prepare", {"messages": to_chat_messages(messages)})
        return from_chat_messages(prepared)

    async def on_api_end(self, kwargs, result):
        await rpc("model", result)

    async def on_function_call_start(self, item):
        self.call_id = item["call_id"]


class ServiceTool(BaseTool):
    def __init__(self, schema, callbacks):
        self.name = schema["name"]
        self._description = schema["description"]
        self._parameters = schema["parameters"]
        self.callbacks = callbacks
        super().__init__()

    @property
    def description(self):
        return self._description

    @property
    def parameters(self):
        return self._parameters

    async def call(self, params, **kwargs):
        result = await rpc("tool", {"call_id": self.callbacks.call_id,
                                   "name": self.name, "arguments": params})
        return json.dumps(result, separators=(",", ":"))


async def main():
    start = json.loads(await asyncio.to_thread(sys.stdin.readline))
    callbacks = Callbacks()
    tools = [ServiceTool(schema, callbacks) for schema in start["tools"]]
    agent = ComputerAgent(model=start["model"], tools=tools, custom_loop=GInferConfig(),
                          callbacks=[callbacks], telemetry_enabled=False, max_retries=0)
    async for _ in agent.run(from_chat_messages(start["messages"]),
                             api_base=start["api_base"], api_key=start.get("api_key")):
        pass
    await rpc("done", {})


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        # Exceptions may contain an HTTP URL; the service keeps the typed failure.
        WIRE.write(json.dumps({"method": "failed", "payload": {"type": type(error).__name__}}) + "\n")
        WIRE.flush()
        sys.exit(1)
