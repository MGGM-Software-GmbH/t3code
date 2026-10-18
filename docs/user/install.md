# Install T3 Code

T3 Code runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch T3 Code and configure providers afterwards.

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

Use the key control in the sidebar to check again or reopen sign-in after
dismissing it. Each environment uses its own installation and cache. Configure
`pd-secrets` and the `~/.claude/.env` mappings on that host in a terminal before
using browser sign-in. A session needs permission to maintain the environment
to sign in.

## Command line

The following commands install upstream releases.

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

This installs the `t3` binary to `~/.local/bin`. If your shell reports `command not found`
afterwards, that directory is not on your `PATH` yet; the installer prints the
line to add. Set `T3CODE_CHANNEL=nightly` to install the nightly train, or
`T3CODE_VERSION` to pin an exact version.

| Task                                             | Command                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| Start the server and open the web app            | `t3`                                                      |
| Start the server without a browser               | `t3 serve`                                                |
| Keep it running in the background (macOS, Linux) | `t3 service install` ([details](./background-service.md)) |
| Move to the newest release                       | `t3 update`                                               |
| Remove it again                                  | `t3 uninstall`                                            |

Run `t3 help` or `t3 --help` for the full reference. To start in a new working
directory, use an explicit path such as `t3 ./my-project`. A bare directory name
is accepted only if it already exists.

If `t3` or `t3 start` reports an already running server, connect to that server
instead. Stop it before starting a replacement, or use a different `--base-dir`
for an independent server.

To try T3 Code once without installing it, run `npx t3@latest` instead (needs
Node.js for `npx`).

### Intel Macs

There is no `t3` executable for Intel Macs (the desktop app is available). To
run a server there, build it from source with Node.js 24 and `vp`
([Install vp](https://github.com/pingdotgg/t3code#install-vp)):

```bash
git clone https://github.com/pingdotgg/t3code
cd t3code && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

`t3 update` and the background service do not apply to a server run this way;
update it with `git pull` and a rebuild.

## Desktop app

Download a release from [GitHub Releases](https://github.com/pingdotgg/t3code/releases),
or use a package manager:

| Platform           | Install                            |
| ------------------ | ---------------------------------- |
| Windows            | `winget install T3Tools.T3Code`    |
| macOS              | `brew install --cask t3-code`      |
| Debian, Ubuntu     | `sudo apt install ./T3-Code-*.deb` |
| Arch Linux         | `yay -S t3code-bin`                |
| Arch Linux nightly | `yay -S t3code-nightly-bin`        |

The `.deb` updates itself like the other desktop builds. It asks for your
password to install each update. If your desktop has no password prompt, the
update fails. Download the new `.deb` and install it the same way.

### The `t3` command

The desktop app includes the `t3` command-line tool. To run it from any
terminal, open **Settings → General → About** and choose **Install** next to
**t3 command**. On macOS and Linux it adds a `t3` link to a folder on your
`PATH`; on Windows it adds the app's command folder to your `PATH`. Open a new
terminal afterwards. **Remove** takes it off again. If you already have `t3`
from npm, it stays as it is.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install the provider CLIs inside that distro. T3 Code installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
t3 app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `t3 app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Install T3 Code from the
[App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or
[Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code).
The phone connects to a server on another machine. Follow
[remote access](./remote-access.md) to link it through T3 Connect or a pairing URL.

Nightly builds need the beta app. The store apps cannot connect to them. A Nightly build also
shows these links as QR codes in **Settings → General → Mobile app**.

- **iPhone and iPad:** join the [TestFlight beta](https://testflight.apple.com/join/XgaxaRtd).
- **Android:** download and install the APK from the
  [Android beta release](https://github.com/pingdotgg/t3code/releases/tag/android-nightly).

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from T3 Code's provider settings.                                                                                         |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |

Provider CLIs must be on the server's `PATH`. If T3 Code cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

T3 Code warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when T3 Code cannot tell. Update a CLI installed with
mise through mise. Cursor and Antigravity update with T3 Code. Homebrew installs
compare against the version Homebrew offers, which can trail the npm release by
a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T3 Code does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Pi](./providers-pi.md), and
[Muse Code](./providers-muse.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating T3 Code](./updating.md): update the app and connected servers.
