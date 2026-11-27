# Install T3 Code

T3 Code runs coding agents on your computer (or server) and lets you control them from the desktop app, web app, or mobile app. Install T3 Code on the machine where your agents will run first.

## Requirements

You need at least one installed, authenticated coding agent (provider) before starting a thread. You can launch T3 Code first and set up providers from the [Welcome page](./welcome-page.md) or **Settings → Providers**.

## MGGM fork (Linux CLI)

```bash
curl -fsSL https://raw.githubusercontent.com/MGGM-Software-GmbH/t3code/main/scripts/install.sh | sh
```

This installs the latest published stable release from `MGGM-Software-GmbH/t3code`
for Linux x64 or ARM64 and verifies the archive against that release's `SHA256SUMS`.
It installs the complete runtime below `~/.t3/runtime/versions` and links
`~/.local/bin/t3`. Add `~/.local/bin` to `PATH` if needed. Rerun the same command
to update the fork; `t3 update` follows upstream releases.

To pin a version, pass `T3CODE_VERSION` to `sh`, for example:

```bash
curl -fsSL https://raw.githubusercontent.com/MGGM-Software-GmbH/t3code/main/scripts/install.sh | T3CODE_VERSION=0.1.0-mggm.2 sh
```

In a devcontainer, install the CLI during the image build and check for a new
release on rebuild. Keep the installed runtime outside the mounted T3 data
directory so the mount does not hide the CLI. Persist T3 data separately. The
installer does not start a server or service.

### MGGM team defaults

A new environment enables one Codex instance. Each employee authenticates their
own Codex CLI with their own team account. Other providers, including the shipped
Copilot entry, stay off until enabled in Settings. Executables are resolved from
`PATH`; the fork does not create additional Codex homes or copy account credentials.

New threads use GPT-6.1 Sol, High reasoning, Standard service, and Full Access.
The model is a favorite; other available Codex models remain selectable. Confirm
model access with the employee's account before the first team rollout. The
default does not grant access to a model the account cannot use.

New clients use the MGGM dark theme, interface/prompt/code sizes of 17/16/15,
the Working shelf, and steering for messages sent during a running turn. Web and
desktop glass opacity is 90%. Inactivity does not automatically settle threads.
Limited threads resume at their reported reset time. Automatic pull is enabled
for clean default-branch checkouts with an upstream and no local commits; pull
requests default to rebase.

These are adjustable defaults. Existing settings, including implicit values in
older sparse settings files, are preserved. Provider update checks start off;
maintain the Codex CLI version through the shared MGGM devcontainer setup.

That setup also supplies the MGGM skills and project rules. Persist writable,
employee-specific volumes for both the T3 home (`~/.t3`, or `T3CODE_HOME`) and
Codex home (`~/.codex`, or `CODEX_HOME`) so rebuilds retain threads, settings, and
the employee's login. Keep these volumes out of shared images and do not share
one account directory between employees. The installer only installs T3 Code;
it does not provision Codex, skills, or volume mounts.

### Password Depot sign-in

When `pd-secrets` is installed on a connected environment, the MGGM fork checks
its cache on connection and once an hour. An expired cache opens a sign-in dialog.
Enter your Password Depot password, then your TOTP code if requested. T3 passes
these inputs to the environment's CLI without saving them. The CLI continues to
own the encrypted cache and its Monday 05:00 expiry policy.
Unsubmitted inputs remain in the open dialog during a temporary connection loss,
including when switching to an authenticator app. Submission waits for reconnection.

Choose **Continue in background** while sign-in or the post-login script is
running to keep using T3. The key control reopens the running operation; any
required TOTP prompt opens automatically. A toast reports background success or failure.
**Cancel** stops sign-in instead. Keep the browser tab open until it ends.

Use the key control in the sidebar to check again or reopen sign-in after
dismissing it. Each environment uses its own installation and cache. Configure
`pd-secrets` and the `~/.claude/.env` mappings on that host in a terminal before
using browser sign-in. A session needs permission to maintain the environment
to sign in.

To run your own setup after sign-in, set **Settings → Sharing & access → pd-secrets →
Post-login script** for that environment. Enter the path to a Bash script on the
server, either absolute or beginning with `~/`. Leave it empty to run no script.
T3 runs it from the server user's home without sign-in inputs or interactive
prompts, waits up to ten minutes, and reports failure without returning script
output. Status checks and thread starts do not run it. Each environment stores
its own path; project overrides do not apply.
If setup fails after sign-in, the dialog reports the script error without asking
for the password again. The Password Depot connection remains valid. Correct the
script on that environment; repeating sign-in is not needed to use its cached secrets.

## Command line

The following commands install upstream releases.

Install the `t3` command to `~/.local/bin`:

```bash
# macOS / Linux
curl -fsSL https://t3.codes/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://t3.codes/install.ps1 | iex
```

Set `T3CODE_CHANNEL=nightly` for nightly builds or `T3CODE_VERSION=<ver>` to pin a version. To try once without installing, run `npx t3@latest` (requires Node.js; always runs the latest stable release).

| Task                          | Command                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| Start server and open web app | `t3` (or `t3 ./my-project`)                                             |
| Start server without browser  | `t3 serve`                                                              |
| Set up remote access          | `t3 up` ([Remote access](./remote-access.md))                           |
| Run in the background         | `t3 service install` ([Background service](./background-service.md))    |
| Update                        | `t3 update`                                                             |
| Reclaim database space        | `t3 doctor` ([Details](./background-service.md#reclaim-database-space)) |
| Uninstall                     | `t3 uninstall`                                                          |

If `t3` reports a server is already running, connect with `t3 pair` or pass a separate `--base-dir`. Run `t3 --help` for all commands.

### Intel Macs

There is no standalone `t3` binary for Intel Macs—use the desktop app, or build a server from source with `vp` ([development runbook](../operations/00_development.md#first-checkout)):

```bash
git clone https://github.com/pingdotgg/t3code
cd t3code && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

## Desktop app

Download from [GitHub Releases](https://github.com/pingdotgg/t3code/releases) or install via a package manager:

| Platform                | Command                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| macOS                   | `brew install --cask t3-code`                                    |
| Windows                 | `winget install T3Tools.T3Code` or `scoop install extras/t3code` |
| Debian / Ubuntu         | `sudo apt install ./T3-Code-*.deb`                               |
| Arch Linux              | `yay -S t3code-bin` (or `yay -S t3code-nightly-bin`)             |
| Nix (flakes, Nix 2.30+) | `nix profile add github:NixOS/nixpkgs/nixos-unstable#t3code`     |

- **Linux AppImage**: `chmod +x ./T3-Code-*.AppImage && ./T3-Code-*.AppImage` (x86_64 and ARM64). `.deb` self-updates with a password prompt; update AUR packages via your AUR helper (`yay -Syu`).
- **NixOS / Home Manager**: Add `pkgs.t3code` to `environment.systemPackages` or `home.packages` (`t3code-desktop` launches the app; `t3` is included). Update via Nix rather than the in-app updater.

### The `t3` command

The desktop app bundles `t3` and sets it up on first launch (manage anytime under **Settings → About → t3 command**). Use **Add to PATH** if needed, then open a new terminal.

- **Open a folder in the running desktop app**: Run `t3 app` (or `t3 app ../my-project`) from a terminal, or drag folders from your file manager onto the desktop sidebar.

### Windows Subsystem for Linux

Select a WSL distro in **Settings → Sharing & access** to run agents and projects inside WSL (install provider CLIs inside that distro). T3 Code manages its own server runtime inside WSL automatically.

## Mobile app

Install from the [App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or [Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code) (QR codes are also in **Settings → About → Mobile app**). The mobile app connects to a server on another machine via [remote access](./remote-access.md).

- Store builds work with both Stable and Nightly servers. Optional Android beta APKs are under [Android beta releases](https://github.com/pingdotgg/t3code/releases?q=android-beta-).
- If the mobile app crashes on launch, open **Settings → Diagnostics** on the next launch to copy recent startup crash reports.

## Providers

Open **Settings → Providers** (web or desktop), select the environment, and enable the providers you use. Installation and sign-in always happen on the **environment's machine**.

| Provider         | Install and authenticate                                                                                                 | Guide                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Codex**        | Connect with ChatGPT in Settings, or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. | [Codex](./providers-codex.md)             |
| **Claude**       | Install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`.                               | [Claude](./providers-claude.md)           |
| **Cursor**       | Sign in in Settings or install [Cursor CLI](https://cursor.com/cli) and run `agent login`.                               | [Cursor](./cursor.md)                     |
| **Grok Build**   | Install [Grok Build CLI](https://x.ai/cli) and run `grok login`.                                                         | [Grok](./providers-grok.md)               |
| **Antigravity**  | Install managed runtime and sign in with Google in Settings.                                                             | [Antigravity](./providers-antigravity.md) |
| **OpenCode**     | Install [OpenCode](https://opencode.ai) and run `opencode auth login`.                                                   | [OpenCode](./providers-opencode.md)       |
| **Kiro**         | Install [Kiro CLI](https://kiro.dev/docs/cli/) and run `kiro-cli login`.                                                 | [Kiro](./providers-kiro.md)               |
| **Pi**           | Install [Pi](./providers-pi.md) (Node.js 22.19+) and run `pi` → `/login`.                                                | [Pi](./providers-pi.md)                   |
| **Muse Code**    | Install [Muse Code](https://dev.meta.ai/docs/muse-code) and run `muse login`.                                            | [Muse Code](./providers-muse.md)          |
| **fx**           | Install [fx](https://fx.sh) and run `fx login`.                                                                          | [fx](./providers-fx.md)                   |
| **ACP Registry** | Add GitHub Copilot and other agents in **Settings → Providers → Add provider → Show more**.                              | [ACP](./providers-acp.md)                 |

- **Binary path**: If a CLI isn't on the server's `PATH` (common with version managers), set **Binary path** in the provider's settings.
- **Updates**: Click **Update now** on outdated provider cards (supports Homebrew, mise `latest`, npm/pnpm/Yarn/Bun/Volta/Vite+, or the CLI's own updater; update Nix, Chocolatey, or pinned mise installs manually).
- **Multiple instances**: Add extra provider instances for separate accounts, API keys, or custom endpoints (mark secret env vars as sensitive).

### Provider check timeouts

If a working CLI times out during T3 Code's readiness check, increase its probe deadline (in milliseconds) in the server's environment (or systemd override / `service.env`) and restart:

```bash
T3CODE_CODEX_PROBE_TIMEOUT_MS=60000 T3CODE_CLAUDE_PROBE_TIMEOUT_MS=60000 t3 serve
```

| Provider     | Environment variable                   |
| ------------ | -------------------------------------- |
| Codex        | `T3CODE_CODEX_PROBE_TIMEOUT_MS`        |
| Claude       | `T3CODE_CLAUDE_PROBE_TIMEOUT_MS`       |
| Cursor       | `T3CODE_CURSOR_PROBE_TIMEOUT_MS`       |
| Antigravity  | `T3CODE_ANTIGRAVITY_PROBE_TIMEOUT_MS`  |
| Grok         | `T3CODE_GROK_PROBE_TIMEOUT_MS`         |
| Kiro         | `T3CODE_KIRO_PROBE_TIMEOUT_MS`         |
| fx           | `T3CODE_FX_PROBE_TIMEOUT_MS`           |
| Pi           | `T3CODE_PI_PROBE_TIMEOUT_MS`           |
| Muse Code    | `T3CODE_MUSE_PROBE_TIMEOUT_MS`         |
| OpenCode     | `T3CODE_OPENCODE_PROBE_TIMEOUT_MS`     |
| ACP Registry | `T3CODE_ACP_REGISTRY_PROBE_TIMEOUT_MS` |

## Next steps

- [User guide index](./README.md): overview of how T3 Code works.
- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): control when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Updating T3 Code](./updating.md): keep apps, servers, and providers up to date.
