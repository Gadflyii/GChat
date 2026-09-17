# Native terminal startup

The Code tab uses OpenCode's supported `--mini` interactive interface to open
directly at a coding prompt without its full-screen home logo and central input.
The workspace argument, provider configuration, permissions and terminal lifetime
remain unchanged. GChat does not send a synthetic model prompt to dismiss a screen.

On Windows, Hermes's uv-created Python launcher can reference a minor-version
junction rejected by the process's enabled redirection-trust policy. The resulting
uv error reports a missing child even though the physical Python installation exists.
Before launching the default managed Hermes installation, resolve its declared
Python home's junctions and refresh the existing venv using that physical Python.
Use uv's offline, allow-existing mode: keep packages, configuration and user data;
do not download Python or disable Windows process mitigations. Verify Hermes imports
after repair. Materialize the TUI's `@hermes/ink` and `@hermes/shared` local
workspace dependencies as physical package directories as well; preserve their
original junctions beside them for recovery. Other npm packages remain untouched.
A custom executable remains user-owned and is not rewritten.

Qualification on Windows: with redirection-trust policy enabled, the original
junction produces WinError 448 and the venv launcher produces uv error 2. The
repaired launcher imports Hermes and `hermes --version` succeeds under the same
policy; repeating repair succeeds without further mutation. A native Windows
pseudoterminal launch reaches Hermes's ready state after both repairs. OpenCode
`--mini` reaches its inline prompt in the configured workspace without a model request.
