# ACP providers

T3 Code can run any coding agent from the official [ACP Registry](https://agentclientprotocol.com/get-started/registry) or any local ACP-compatible command. Built-in providers (Codex, Claude, Cursor, Grok, OpenCode, Pi, Antigravity) are enabled directly in **Settings → Providers** instead.

T3 Code negotiates ACP v2 preview when supported and falls back to ACP v1 automatically. For `claude-agent-acp`, set `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=0` in the instance's environment overrides if you need ACP v1.

## GitHub Copilot

GitHub Copilot is included as a configured provider and uses `copilot` from the connected
environment's PATH. Install the [Copilot CLI](https://github.com/github/copilot-cli) on each
environment, then open **Settings → Providers → GitHub Copilot** and complete sign-in if requested.
Select one of its models in the composer. Sign-in is separate for each environment. You can disable
the provider without removing your account.

The shipped preset does not install or update the CLI automatically. If `copilot` is missing from
the environment's PATH, install it or set **Executable override** to its absolute path. Existing
provider configurations keep their executable selection; set this field to `copilot` to use PATH.

To opt into a T3-managed Registry installation, clear **Executable override**. Managed installations
honor the environment's npm settings. If a minimum release age blocks the Registry's version, use
an existing Copilot executable or retry when that version meets your policy.

## Add an agent

- **From the ACP Registry**: Open **Settings → Providers → Add provider → Show more**, search for an agent compatible with your server, click **Add**, and complete sign-in. Registry agents are third-party code—review an agent's source and license before adding it.
- **Local ACP command**: Under **Show more → Local ACP command**, enter the executable path/name, literal arguments (one per row—no shell expansion; e.g., `dsh` with `--profile` and `acp`), and a display name.

## Installation and updates

Registry agents run on your T3 Code server (including when accessed remotely) and install under `<t3-home>/tools/<agent-id>/<version>/` with SHA-256 verification when provided. T3 Code checks for Registry updates in the background and installs them on the next provider refresh. Set **Executable override** to use your own local binary instead.

## Sign in

Open the agent's account section in **Settings → Providers** and click **Sign in** (choose an auth method if multiple are offered).

- **Browser sign-in**: Opens the auth URL on your device while the agent runs on the server.
- **Terminal sign-in**: Runs in an in-app terminal on the server (or uses a response field on mobile).
- **API keys**: Add required variables in the instance's **Environment** settings.

Credentials stay in the agent's own store; changing a shared login stops running threads for that agent on the server while keeping history.

## Models, commands, and native sessions

T3 Code checks the Registry for new versions in the background and installs them for T3-managed
agents on the next provider check; a check is skipped while that agent is starting a session.
Refreshing providers in Settings checks the Registry right away.

## Signing in

Open the agent's account section in **Settings → Providers** on web or desktop. Choose
**Sign in** and, if the agent offers several methods, select one. For an installed, configured
provider, mobile also offers **Settings → Providers**.

Browser sign-in shows the agent's URL and waits for you to open or copy it before telling the
agent to proceed. The page opens on your device, while the agent runs on the environment.
Terminal methods run in an in-app terminal on that environment. On mobile, send responses
through the terminal response field. T3 Code reconnects after terminal login and waits for the
agent to confirm sign-in before reporting success. You can cancel or retry an expired attempt.

Browser and terminal sign-in leave credentials in the agent's own store. Agents that use API keys
through environment variables still take those keys in the instance's environment settings.
A configured environment or agent home applies to both sign-in and chat.

Copilot CLI's **Log in with Copilot CLI** method opens its login command in the in-app terminal.
On a remote environment, open the displayed GitHub device URL on your own device and enter the
one-time code. T3 Code reconnects to Copilot after the command exits to verify the account.

If the agent advertises logout, choose **Sign out**. Changing a shared agent login stops running
threads for instances of that same agent on the environment. Thread history and workspace files
are kept. ACP does not describe account isolation, so adding another instance does not guarantee
a separate account; use the agent's own configuration to isolate accounts when supported.

If an agent cannot complete its advertised flow remotely, its CLI remains available on the
server. For example, Codex supports `codex login --device-auth`, and Grok Build supports
`grok login --device-auth`.

## Models and options

The model picker lists the models the agent reports. If the agent reports none, or hides some, add
your own model IDs under **Custom models** in the instance settings.

Other settings the agent offers, such as reasoning effort or approval mode, appear in the
composer's model picker, beside the model list, like they do for built-in providers. Models and options that change while an agent
is running update the picker without waiting for another provider probe.

## Commands and skills

Slash commands the agent provides appear under **Provider** in the `/` menu while a session is
running. Commands the agent names with a `$` prefix appear in T3 Code's `$` skill menu instead.

## Native sessions

When an agent advertises ACP session listing and import support, expand its provider card,
choose a project, and select **List sessions**. Importing one creates a deterministic T3 thread
backed by that native session. Importing the same agent session again returns the existing thread,
including when another client performs the import.

The thread keeps the native session's title and last-update value as provider metadata without
overwriting a title you set in T3 Code. Agents that report ACP context usage drive the thread details
context window and cumulative cost metadata. See
[commands and skills](./composer.md#commands-and-skills) to show it on web and desktop.
Text resources and links render as assistant output;
binary resources, images, and audio that T3 Code cannot render yet appear as explicit placeholders
instead of disappearing.

## Permissions and terminals

Registry agents enforce their own sandbox and approval rules (switchable via their mode picker in model options). When an agent asks for approval, T3 Code answers according to the thread's [permission mode](./permission-modes.md):

- **Supervised**: Shows approval requests in chat.
- **Auto-accept edits**: Auto-approves edits inside the thread's folders; asks for everything else.
- **Auto** and **Full access**: Approves automatically.

File reads and searches never wait for approval. Devin runs commands in T3 Code terminals; other agents run their own terminals and report output/exit status.

## Checkpoints

Checkpoint rollback restores workspace files as usual. Because ACP agents cannot rewind their own conversation, the next turn starts a fresh session with the kept conversation history.
