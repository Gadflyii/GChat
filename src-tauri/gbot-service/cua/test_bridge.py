"""Exercise the real ComputerAgent process and Gbot IPC with a loopback model."""
import json
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class BridgeTest(unittest.TestCase):
    def test_prepared_history_raw_reply_and_async_tool_result(self):
        requests = []

        class Model(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                requests.append((body, self.headers.get("Authorization")))
                message = ({"role": "assistant", "content": None, "tool_calls": [{
                    "id": "call-1", "type": "function", "function": {
                        "name": "echo", "arguments": '{"value":"saved"}'}}]}
                    if len(requests) == 1 else {"role": "assistant", "content": "Done"})
                data = json.dumps({"choices": [{"message": message}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        process = subprocess.Popen([sys.executable, "-u", str(Path(__file__).with_name("bridge.py"))],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, text=True)
        events = []
        try:
            process.stdin.write(json.dumps({"model": "assigned", "api_key": "fixture-key",
                "api_base": f"http://127.0.0.1:{server.server_port}/v1",
                "messages": [{"role": "user", "content": "Echo"}],
                "tools": [{"name": "echo", "description": "Echo a value",
                           "parameters": {"type": "object", "properties": {
                               "value": {"type": "string"}}, "required": ["value"]}}]}) + "\n")
            process.stdin.flush()
            for line in process.stdout:
                event = json.loads(line)
                events.append(event)
                method = event["method"]
                if method == "prepare":
                    result = event["payload"]["messages"]
                    if not any(message["role"] == "system" for message in result):
                        result.insert(0, {"role": "system", "content": "Prepared by shared context"})
                elif method == "tool":
                    self.assertEqual(event["payload"], {
                        "call_id": "call-1", "name": "echo", "arguments": {"value": "saved"}})
                    result = {"text": "saved", "ok": True}
                else:
                    self.assertIn(method, {"model", "done"})
                    result = None
                process.stdin.write(json.dumps({"ok": result}) + "\n")
                process.stdin.flush()
                if method == "done":
                    break
            process.stdin.close()
            self.assertEqual(process.wait(timeout=10), 0)
            self.assertEqual([event["method"] for event in events],
                             ["prepare", "model", "tool", "prepare", "model", "done"])
            self.assertEqual(len(requests), 2)
            for body, _ in requests:
                for field in ("temperature", "top_p", "top_k", "min_p",
                              "presence_penalty", "frequency_penalty"):
                    self.assertNotIn(field, body)
            self.assertEqual(requests[0][1], "Bearer fixture-key")
            self.assertEqual(requests[0][0]["messages"][0]["content"], "Prepared by shared context")
            tool = requests[1][0]["messages"][-1]
            self.assertEqual(tool["tool_call_id"], "call-1")
            self.assertEqual(json.loads(tool["content"]), {"text": "saved", "ok": True})
            self.assertEqual(events[-2]["payload"]["choices"][0]["message"]["content"], "Done")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
