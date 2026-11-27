# Settings and project overrides

## FogBugz

In **Settings > MGGM**, select an environment and connect your existing MGGM FogBugz account using its base URL, email and password. The environment stores the API token in its server-side secret store. Use **Test connection**, **Save changes**, or **Disconnect** to manage it.

The FogBugz settings show when your server lacks project groups, automatic browser sign-in, or Case-Git. Individual project links and ordinary threads remain usable. Without automatic browser sign-in, sign in directly in the Browser panel. Existing links and files are preserved; a missing group feature requires a FogBugz update or an explicit change to a single-project link. After updating FogBugz, use **Test connection** to check feature support again.

In **Settings > Projects**, select a T3 project and choose a **FogBugz project or group** visible to your account. A group includes all its currently accessible projects, including later membership changes. Each T3 project has its own assignment. Choose **Not linked** to remove it.

For a directly linked FogBugz project, optionally choose a **FogBugz area**. **All areas** includes the entire project. A selected area restricts case lists, thread creation from those lists, and automation to cases in that area. Project groups cannot have an area restriction. Changing or clearing the project, group, or area preserves thread-case links and resets automation tracking.

Open **Fogbugz Cases** from the sidebar menu or command palette to see open cases assigned to that account in linked projects. Search, filter, or refresh the list. The **+** menu processes a case in a new linked thread. When several T3 projects match, choose the destination project first. Existing threads appear as direct links.

In an existing thread, choose **Link FogBugz case** in thread details and enter the number of any case your connected account can read. This works across projects and areas, including when the T3 project has no FogBugz mapping. Use **Unlink FogBugz case** in the same panel to remove the association.

In any saved thread in a mapped T3 project, open **Fogbugz-Cases** from the side panel to browse the project's cases. The list uses the selected FogBugz area or project group even when the thread has no linked case.

For a thread linked to a case, **FogBugz-Case-Git** in the FogBugz section of thread details or the side panel's surface menu opens that case's files using the existing file viewer. By default, T3 prepares a separate local clone for each thread under `<T3 home>/case-files/<connection>/<person>/<case>/<thread>/repo`. In **Settings > Projects > FogBugz**, set **Case-Git checkout folder** to share one checkout per case across the project's threads. Use an absolute path or a path relative to the project root; case 12345 uses `<folder>/FB12345`. The folder may be inside the project repository. For SVN projects, adding this folder to `svn:ignore` is recommended. T3 does not change SVN properties. Clearing or changing the setting keeps existing checkouts on disk. FogBugz creates a missing repository when your account has write access and the project's case file storage is enabled. Unlinking preserves the local files and the FogBugz repository.

Drop files into this panel to add them at the checkout root, or onto a folder to add them there. You can also upload through the file picker, create files and folders, and delete selected entries after confirmation. A folder's context menu creates or uploads directly into that folder. Existing files are never overwritten by an upload. These actions change the local checkout. Use the Git menu's **Commit** action to review the changed paths, enter a message and publish the case commits. **Revert** discards uncommitted changes after confirmation, including new files; existing commits and ignored files are kept. **Update** fetches remote changes and applies fast-forwards or conflict-free merges without publishing local commits. The regular file refresh only reloads the local file list. Save or discard open editor changes before using Git actions. Empty folders remain local until they contain a file. File changes are unavailable while an agent is using the same checkout or the FogBugz account lacks write access. A shared checkout accepts only one agent turn at a time; finish that turn before starting work there from another thread.

If the FogBugz project has file storage disabled or your account cannot access its files, the file panel explains that the storage is unavailable. Ordinary linked turns can still run without a case checkout. After storage or access is enabled, retry in the file panel.

When case file storage is available, linked threads store planning artifacts, including INITIAL.md, PRP.md and prototypes, in the case checkout. Instructions that name the project's `docs/prp/` directory are redirected there. T3 gives the agent the checkout path and the server's file-size limits before each turn. The agent creates local checkpoint commits; T3 uploads those commits to the case repository after the turn. T3 checks for remote changes when opening the checkout and before a turn, and applies fast-forwards or conflict-free merges. Uncommitted changes and conflicts are preserved and reported for your decision. Synchronization does not change files while the agent is running.

In either list, **Add to Context** adds a case reference to the composer without starting an agent run. **Create PRP** starts planning; **Implement** starts implementation. The side panel uses the current thread, including a new thread before its first message. These actions pass the case number and instructions to read it through the FogBugz MCP, rather than copying the case history into the prompt. The agent needs access to that MCP.

Cases show category, status, priority, assignee and your latest notification time, or the last update when there is no notification. The list sorts by that displayed date, then by the last case update.

Linked threads show the case category icon and FogBugz project name in the thread list, with priority and status below the title.

Configure **Auto-Settle on**, **Auto-Unsettle On reactivate**, and **Auto-Analyze New Cases** in **Settings > MGGM**, or override them for a project in **Settings > Projects**. All three start disabled. The server checks linked projects every 30 seconds, even when the client is closed. Settling waits for active agent work to finish; reactivation shows the thread again without starting a turn.

**Only initial event** analyzes new cases whose first two events are **Opened**, then **Assigned** to you. **Any assigned to me** also handles later assignments to you. Enabling analysis establishes a baseline on the next check; existing assignments do not start work. Each new assignment starts a separate linked thread using the project's default model and an analysis-only request through the FogBugz MCP. This can incur provider costs. Automatic analysis does not request implementation, file changes, or FogBugz comments. A missing default model prevents the run.

For a later assignment, the analysis focuses on what you are expected to contribute now. It uses the assignment event and discussion to identify the requested review, decision, clarification, investigation, test, or implementation task, distinguishes explicit requests from inferred expectations, and flags missing information. New cases retain the initial requirements analysis.

Click a case number to open it in a new browser tab using your existing FogBugz browser session. This link does not pass an API token.

Creating a linked thread from the case list opens the case in the Browser panel using the selected browser profile. Switching between existing threads preserves your panel selection, including a closed panel. Use **Open FogBugz case** in thread details to open it again. T3 exchanges the stored API token for a browser session without another password prompt. This requires the MGGM FogBugz browser-session API. Changing the base URL for the same account preserves its sign-in and existing links. Changing the account or disconnecting removes the affected links while preserving T3 threads and FogBugz cases. FogBugz comment editing is not included.

T3 Code separates **device preferences** (saved locally per browser/device, like Appearance and Confirmations) from **server settings** (stored on each environment, like Threads, Worktrees, and Source control).

## Scope and inheritance

Use the **"Applying settings for …"** selector at the top of Settings (web/desktop) or the header filter (mobile) to choose which **environment(s)** and **project** you are editing:

- **All environments**: Bulk-edits every currently connected environment (offline environments keep their values). Controls show **Mixed** where environments disagree.
- **Project scope**: Creates a project override for that setting without changing environment defaults. Settings that cannot be overridden appear read-only.
- **Inheritance order**: `Project override` → `Environment setting` → `t3.json` in the repo → `Built-in default`. Leave a setting on **Inherit** to defer to the next tier.
- Click the **layers icon** beside a server setting to inspect its inheritance chain, jump to overriding projects, or **Reset all** back to the environment default.
- **Per-project providers**: With a project selected in **Settings → Providers**, toggling a provider enables or disables it for that project only (in either direction). Running turns finish; no new turns start on a disabled provider.

## Pin and archive projects

- **Pin**: Pinned projects sort first in project pickers, the command palette, the sidebar filter, and mobile (`mod+shift+p` on a highlighted row, or **Settings → Projects**).
- **Archive**: Archive finished projects in **Settings → Projects** (mobile: **Settings → Projects → Organize**). Archived projects leave pickers while keeping their threads, settings, and files; unarchive anytime from Settings.
- Pinning or archiving a project that exists on multiple machines requires all of those machines to be connected.

## Project icons and multi-repo projects

- **Icons**: In **Settings → Projects**, set an icon, emoji, monogram, or image (applies across checkouts). Without one, T3 Code generates a two-character monogram (or single CJK character) from the project name.
- **Multiple repositories**: See [Projects with several repositories](./multi-repo-projects.md).

## Worktree settings

Configure worktrees in **Settings → Worktrees** (environment default or project override):

- **Branch naming**: Choose a static prefix (default `t3/`), model-selected semantic prefix (`feat/`, `fix/`), or custom instructions. Falls back to the temporary branch name if generation fails or collides.
- **Submodules** (under Advanced): Defaults to recursive checkout; set to **Top level only** or **Skip** (or `"worktreeSubmodules"` in `t3.json`) for repos with heavy nested submodules.
- **Sparse checkout**: Set `"worktreeSparsePatternsPath"` in `t3.json` to a repo-relative file of Git sparse-checkout patterns (non-cone syntax; requires Git 2.35+; enables `extensions.worktreeConfig`). Set Submodules to **Skip** if you don't want submodules initialized under excluded paths.
- **Worktree location** (per machine): Set an absolute path (e.g. `D:\worktrees` or `~/worktrees`) to store new worktrees elsewhere. Existing worktrees stay where they are; cleanup covers both folders.
- **Fast worktree checkout (macOS beta)**: Enable **Settings → Labs → Fast worktree checkout** (Git 2.42+) to clone new worktrees via APFS copy-on-write from a local cache. Falls back to normal checkout for cross-drive paths, sparse checkouts, or Git LFS/filter repos.

### Storage cleanup

Enable automatic cleanup in **Settings → Worktrees → Cleanup** (off by default; runs on startup, on change, and hourly). Projects can set **Automatic worktree cleanup** to **Inherit**, **Off**, or **Custom**.

- **Triggers**: Inactive days, days after settlement (`0` = next cleanup), merged PRs (including GitHub squash/rebase merges into the default branch), or settled/archived threads with no commits beyond the default branch.
- **Safety**: Active sessions and shared worktrees are never removed. **Keep worktrees with local changes** defaults to **Uncommitted changes** (protects tracked edits and untracked files; removes ignored files like `.env`/build output). Choose **Any local files** (also protects ignored files except `node_modules`) or **Edited tracked files** (protects tracked edits only).
- **Delete with deleted threads**: Enable **Delete worktrees with deleted threads** to automatically clean up safe worktrees once their last thread is deleted.
- **Scratch folders**: Inactive and settled rules also apply to [no-project scratch folders](./thread-sidebar.md#start-without-a-project) (skipped if they contain a Git repo or enabled scheduled task). Because scratch files aren't in Git, deleted files cannot be recovered.
- **Manual run**: Click **Delete now** to run rules immediately and inspect what was removed, kept, or orphaned (untracked folders are listed but never auto-deleted).
- **Captures and logs**: Browser captures and rotated logs have separate machine-wide retention periods.

## Keep the default branch current

Enable **Settings → Source control & issues → Automatically pull** to fast-forward clean default-branch checkouts from their configured upstream. Skips checkouts with local changes, untracked files, local commits, other branches, or no upstream.

## General settings

Under **Settings → General → Notifications**, **Slow request warning threshold** sets how
long this browser waits before warning about a slow request. The default is 60 seconds;
set it to `0` to disable these warnings. Changes take effect without reloading.

In **General**, set **Model capacity retry delay** to the number of minutes to wait after
"Selected model is at capacity. Please try a different model." The default is 5 minutes;
0 disables automatic retries. Retries keep the same provider, model, and model options.
Use **Play** in the stopped thread to continue immediately, or cancel its scheduled retry
in the thread's recovery notice. A server restart preserves the scheduled retry. Changing
the thread's model prevents the old capacity failure from automatically starting another model.

## Scheduled tasks and webhooks

Create and manage scheduled tasks in **Settings → Scheduled tasks** (web, desktop, and mobile).

- **Schedules**: Recurring fixed-time schedules use the target environment's time zone. **Once** uses your local time zone (runs on reconnect if offline).
- **Destination**: Choose **New thread each run**, **One thread (continue conversation)**, or **One thread (fresh session each run)**. Deleting a target thread deletes tasks bound to it; archiving a target thread causes runs to fail (settle it instead).
- **Controls**: Edit, pause, resume, run now (except webhook tasks), or delete from the list.

For a monthly weekday, choose **At a time**, select **First of every month**
under **Week of month** (or **Repeat** on the web), and select Wednesday.
The same menu offers the second, third, fourth, fifth, or last occurrence.
A fifth weekday skips months without that occurrence. These schedules use
the environment's time zone and keep their local time across daylight-saving changes.

### Webhook automations

Choose **On webhook** as a task's schedule to trigger runs from external services (e.g., GitHub PR or CI events). A public URL requires a [T3 Connect](./remote-access.md) tunnel; click **Rotate** to invalidate and replace the URL.

- **Prompt placeholders**: Insert `{{body.path}}`, `{{headers.name}}`, `{{query.name}}`, `{{body}}`, or `{{request}}`. Missing values render empty.
- **Untrusted input protection**: Placeholder values are wrapped in `<webhook-data-…>` tags, and `$`/`@`/leading `/` tokens are neutralized so untrusted payloads can't invoke skills or commands.
- **Signatures** (web/desktop setup): Enable **Require signature** to verify HMAC signatures (for GitHub, keep `x-hub-signature-256`, hex, and `sha256=` prefix with the same secret and `application/json`).
- **Filters**: Add conditions (using paths without braces, e.g. `headers.x-github-event` equals `pull_request`, or `body.action` is one of `opened, reopened`). All filters must match; non-matching requests are logged as **Filtered**.
- **Deduplication & coalescing**: Set a **Duplicate request key** (e.g. `{{headers.delivery-id}}`; ignores repeats for 7 days) or a **Coalesce key** with a 10–3600s window (default 120s; runs once with the latest payload when the window closes). Coalesced updates are rate-limited to 60/min (`HTTP 429`).
- **Offline delivery**: By default, offline environments return an error. Enable **Settings → Sharing & access → Hold webhooks while offline** to buffer T3 Connect webhooks for up to 24 hours, and optionally set **Skip requests older than** on the task.
- **Debugging**: Open **Deliveries** from a task's menu (web/desktop) to inspect recent payloads and rendered prompts.
