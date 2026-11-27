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

Copilot CLI's **Log in with Copilot CLI** method opens its login command in the in-app terminal.
On a remote environment, open the displayed GitHub device URL on your own device and enter the
one-time code. T3 Code reconnects to Copilot after the command exits to verify the account.

## Models, commands, and native sessions

- **Models & options**: Reported automatically by the agent in the model picker. Add unlisted model IDs under **Custom models**.
- **Commands & skills**: Agent slash commands appear under **Provider** in `/`; `$`-prefixed commands appear in the `$` skill menu.
- **Native sessions**: When supported by the agent, expand its provider card, choose a project, and select **List sessions** to import existing sessions into T3 Code threads.
- **Text generation**: Select an ACP model in **Settings → Threads → Text generation model** to generate titles, commit messages, and PR descriptions.

## Permissions and terminals

Registry agents enforce their own sandbox and approval rules (switchable via their mode picker in model options). When an agent asks for approval, T3 Code answers according to the thread's [permission mode](./permission-modes.md):

- **Supervised**: Shows approval requests in chat.
- **Auto-accept edits**: Auto-approves edits inside the thread's folders; asks for everything else.
- **Auto** and **Full access**: Approves automatically.

File reads and searches never wait for approval. Devin runs commands in T3 Code terminals; other agents run their own terminals and report output/exit status.

## Checkpoints

Checkpoint rollback restores workspace files as usual. Because ACP agents cannot rewind their own conversation, the next turn starts a fresh session with the kept conversation history.
