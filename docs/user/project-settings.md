# Settings and project overrides

T3 Code separates **device preferences** (saved locally per browser/device, like Appearance and Confirmations) from **server settings** (stored on each environment, like Threads, Worktrees, and Source control).

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

## Settings scope

On web and desktop, the "Applying settings for …" sentence at the top of Settings pages picks
the project and environment a change applies to. Pages that only hold device preferences, such as
Appearance, don't show it. They start at **All projects** and **All environments**
and stay selected as you move between categories or search for a setting.

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

For a monthly weekday, choose **At a time**, select **First of every month**
under **Week of month** (or **Repeat** on the web), and select Wednesday.
The same menu offers the second, third, fourth, fifth, or last occurrence.
A fifth weekday skips months without that occurrence. These schedules use
the environment's time zone and keep their local time across daylight-saving changes.

Under **Destination**, choose where runs go. **New thread each run** keeps every
run separate. The two one-thread choices start a thread on the first run and post
later runs there: one continues the same conversation, the other starts each run
in a fresh session that doesn't see earlier runs, so the thread stays readable
without the agent's context growing. To move a one-thread task, pick another
thread in its project under **Destination**. Moving such a task to another
project starts a new thread there on its next run.

Deleting a thread also deletes tasks that post into that thread. Tasks that start
a new thread on each run survive deletion of their previous threads.
An archived thread refuses messages, so a task that posts into one stays on and fails
each run until you unarchive the thread or pick another destination. To set a task's thread
aside without breaking it, settle the thread; see [Settle or archive](thread-sidebar.md#settle-or-archive).

You can edit, pause, resume, run immediately, or delete a task from the list.
Webhook tasks only run when their URL is called, so they can't be run
immediately.
Leaving an edited form asks before discarding unsaved changes.

## Webhook automations

In **Settings → Scheduled tasks**, choose **On webhook**
as a task's schedule to run it whenever another service calls its URL, such as
GitHub on a new pull request or a CI job that failed. A public URL needs a
[T3 Connect](remote-access.md) managed tunnel; after you save the task, copy
its URL from the editor. Without one, the editor shows only the URL's path.
**Rotate** replaces the URL and the old one stops working.

The prompt decides what the agent sees. Placeholders pull values out of the
request: `{{body.path}}` for a JSON or form field, `{{headers.name}}`,
`{{query.name}}`, `{{body}}` for the raw body, and `{{request}}` for everything.
For example, `Review this PR: {{body.pull_request.html_url}}` sends only the
pull request link. A placeholder with no value is left empty.

Each value reaches the agent wrapped in `<webhook-data-…>` tags and marked as
untrusted request data. This helps the agent tell it apart from your
instructions, but it doesn't guarantee the agent ignores what the text says.
Inside a value, every `$`, other currency sign and `@`, and a `/` that starts
a lone word, gets an invisible character after it, so mentions like `$skill`,
`@file` and `/command` don't act. Text copied from a value, such as an email
address or a command, carries that character too. Without a signature, anyone
with the URL can start a run with any content. A signature only proves which
service sent the request: a GitHub payload still carries text written by any
GitHub user.

For GitHub, turn on **Require signature**, keep the header
`x-hub-signature-256`, hex encoding and the `sha256=` prefix, and enter the
same secret in the repository's webhook settings with content type
`application/json`. Requests without a valid signature are rejected. Set this
up on desktop or web; mobile keeps an existing signature check but can't turn
one on.

To run only for some requests, add **Filters**. Each one tests a value named
like a placeholder, without the braces, such as `headers.x-github-event` equals
`pull_request` or `body.action` is one of `opened, reopened`. A task runs only
when every filter matches; other requests are answered normally, logged as
**Filtered** with the first filter that failed, and start nothing. Values
compare as text, and a value that is an object or a list only passes
**exists**. Separate **is one of** values with commas; a value can't contain
a comma or start or end with a space.

To suppress repeated deliveries, set a **Duplicate request key** template, such as
`{{headers.delivery-id}}`. The same key is ignored for seven days per task.
To combine a burst, set a **Coalesce key**, such as `{{body.id}}`, and a window
of 10–3600 seconds (120 by default). One run uses the latest body, headers,
and query when the window from the first delivery closes; later requests
do not extend it. Pending windows survive a server restart. Keys must contain
request placeholders; if any placeholder is missing, or the render is empty,
that key's rule is skipped. Clear the templates to turn dedupe off.

Duplicate and coalesced log entries share a limit of 10 per task per minute.
Additional deliveries are accepted without a log entry, and coalesced deliveries
always replace the persisted payload. Coalesced updates count toward a separate
60-per-minute validation limit; exceeding it receives HTTP 429.

On desktop and web, pick **Deliveries** from a task's menu to see recent
requests and the prompt each one produced.

If the environment is offline, the sender gets an error and nothing runs;
redeliver from the sender, such as GitHub's **Recent Deliveries**, once it is
back. To have T3 Connect keep requests instead, turn on **Hold webhooks while
offline** in **Settings → Sharing & access**. T3 Connect then stores requests to a
T3 Connect URL for up to 24 hours and delivers them when the environment
returns. Leave it off if you don't want request bodies stored outside your
machine. To skip requests that waited too long, set **Skip requests older
than** on the task.

## Defaults and inheritance

Threads contains the model and workspace for new threads. Browser controls agent browser
access. Source control & issues contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

Under **Settings → General → Notifications**, **Slow request warning threshold** sets how
long this browser waits before warning about a slow request. The default is 60 seconds;
set it to `0` to disable these warnings. Changes take effect without reloading.

The Projects category, under Code, holds the project's name, icon, actions,
checkouts and removal. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`t3.json` actions can be imported there. When a project has several checkouts on one environment,
choose one in the scope line at the top to see or change only that checkout's settings.

Settings a repository can also declare in `t3.json`, such as the workspace for new threads,
resolve in one order: a project override, then the environment setting, then `t3.json`, then the
built-in default. Leave a setting on **Inherit** to let the next tier decide.
Browser access changes apply when an agent session next starts.

New worktrees initialize git submodules recursively. If that step is slow because the repository
declares many nested submodules, set **Submodules** in **Settings → Worktrees** under Advanced (with the project
selected to override it there) to **Top level only** to stop at the ones the repository declares
itself, or **Skip** to leave them for a setup script. It resolves in the same order as the
workspace default: a `"worktreeSubmodules"` value in the `t3.json` of the branch being checked out
applies when the project and environment are both on **Inherit**.

New worktrees check out every file. For a large repository, set `"worktreeSparsePatternsPath"` in
`t3.json` to a repository-relative file of git sparse-checkout patterns in non-cone syntax. New
worktrees then check out only the matching files, before any other file is written. Both files are
read from the branch being checked out, so the patterns can leave out `t3.json` and `.gitmodules`.
If the pattern file is missing, creating the worktree fails instead of checking out everything.
Submodules still follow **Submodules** above, also under excluded paths; set it to **Skip** to leave
them empty. The first sparse worktree turns on Git's `extensions.worktreeConfig` for the repository.
This needs Git 2.35 or newer.

## Worktree location

New worktrees go in the `worktrees` folder of the T3 home directory. To put them somewhere else,
such as another drive, set **Settings → Worktrees → Worktree location** to an absolute path like
`D:\worktrees` or `~/worktrees`. The setting is per machine. Existing worktrees stay where they
are, and cleanup covers both the default folder and the custom one.

## Fast worktree checkout on macOS

Fast worktree checkout is a beta. Turn it on for each Mac in **Settings → Labs → Fast worktree
checkout**. T3 Code then keeps a few recent checkouts of each repository in the `caches` folder of
the T3 home directory. A new worktree is cloned from one of them with APFS copy-on-write, which is
about twice as fast as writing every file and makes the first `git status` in it fast as well.
Turning it off deletes the cache.

The first worktree of a repository uses Git's normal checkout and fills the cache. It needs Git 2.42
or newer. Git's normal checkout is also used for worktrees on a different drive from the T3 home
directory, sparse checkouts, repositories whose attributes use filters such as Git LFS, and
repositories whose checkout settings changed.

## Storage cleanup

Open **Settings → Worktrees → Cleanup** to enable automatic cleanup on one machine or all connected
environments. Policies are off by default and run on the server at startup, when changed, and
hourly. Offline machines keep their existing policies.

Select a project to set **Automatic worktree cleanup** to **Inherit**, **Off**, or **Custom**.
Inherit follows each machine's rules; Off keeps that project's worktrees until you remove them
manually. Custom applies separate worktree rules to the selected project or checkout. Browser
captures and log retention remain machine-wide.

Worktrees can be removed after a chosen number of inactive days, after a thread settles, after
merging, or when they have no commits beyond the default branch and their thread is settled or
archived. Set settled retention to 0 days to remove a worktree at the next cleanup after
settlement. In repositories without remotes,
unchanged-worktree cleanup compares against the branch checked out in the project workspace;
if that checkout has a detached HEAD, the worktree is kept. Only T3-managed worktrees are eligible.
Active sessions and shared worktrees prevent removal. **Keep worktrees with local changes** defaults
to **Uncommitted changes**, which protects tracked edits and untracked files but deletes ignored
files such as `.env` and build output. **Any local files** also protects ignored files other than
`node_modules`. **Edited tracked files** protects only tracked edits and allows untracked and
ignored files to be deleted. Branches and thread history stay; starting another turn recreates the checkout.
Merge cleanup requires a merged pull request whose commits are included in the remote default
branch. A squash or rebase merge on GitHub also counts when the pull request targeted the default
branch and the worktree is still at the pull request's last commit.

Enable **Delete worktrees with deleted threads** to remove safe worktrees after their last
thread is deleted, including archived threads and worktrees left by earlier deletions. The
server waits for sessions and terminals to stop and retries skipped worktrees after restart.
Existing prompts for deleting a worktree manually remain available when this policy is off.

Choose **Delete now** to run the enabled rules immediately. The latest results show which
worktrees were removed or kept and why, plus any failures.
Results also list folders in the worktree folder that no thread uses, with their sizes; cleanup never removes them, so remove them manually if you want.

The inactive and settled retention periods also apply to the folders of
[threads without a project](./thread-sidebar.md#start-without-a-project). Those folders are not
Git repositories, so their files are deleted with them and cannot be recovered; the thread stays,
and its next turn starts in a new, empty folder. A folder is kept when it has a Git repository
anywhere inside it or when its thread has an enabled scheduled task. Every file in such a folder
counts as untracked, so only **Edited tracked files** removes a folder that holds anything other
than `node_modules`; the other two rules remove only empty folders. Folders that no thread uses
are listed here too.

Browser captures and rotated logs have separate retention periods. Expired capture links stop
working. Current logs, message attachments, and browser profiles are kept.

## Retry a busy model

In **General**, set **Model capacity retry delay** to the number of minutes to wait after
"Selected model is at capacity. Please try a different model." The default is 5 minutes;
0 disables automatic retries. Retries keep the same provider, model, and model options.
This setting is independent of usage-limit recovery.

Use **Play** in the stopped thread to continue immediately, or cancel its scheduled retry
in the thread's recovery notice. A server restart preserves the scheduled retry. Changing
the thread's model prevents the old capacity failure from automatically starting another model.

## Project icons

Select the project and open Project to choose an icon, emoji, monogram, or image. The choice applies to
every checkout in the project group and appears on connected clients. Choose **Automatic** to let
T3 Code detect an icon again.

Choose **Monogram** in the icon picker to set one or two letters or numbers and a color.

When no image is found, web and desktop show a two-character monogram with a color
from the icon palette, derived from the saved project name. For example, `Nebula` becomes `NA`,
`Silver Orchard` becomes `SO`, and `M7 Forge` becomes `M7`. A name that starts with a Chinese,
Japanese, or Korean character uses only that character, so `健康顾问` becomes `健`.

## Keep the default branch current

Enable **Settings → Source control & issues → Automatically pull** to fast-forward clean default-branch checkouts from their configured upstream. Skips checkouts with local changes, untracked files, local commits, other branches, or no upstream.

## Scheduled tasks and webhooks

Create and manage scheduled tasks in **Settings → Scheduled tasks** (web, desktop, and mobile).

- **Schedules**: Recurring fixed-time schedules use the target environment's time zone. **Once** uses your local time zone (runs on reconnect if offline).
- **Destination**: Choose **New thread each run**, **One thread (continue conversation)**, or **One thread (fresh session each run)**. Deleting a target thread deletes tasks bound to it; archiving a target thread causes runs to fail (settle it instead).
- **Controls**: Edit, pause, resume, run now (except webhook tasks), or delete from the list.

### Webhook automations

Choose **On webhook** as a task's schedule to trigger runs from external services (e.g., GitHub PR or CI events). A public URL requires a [T3 Connect](./remote-access.md) tunnel; click **Rotate** to invalidate and replace the URL.

- **Prompt placeholders**: Insert `{{body.path}}`, `{{headers.name}}`, `{{query.name}}`, `{{body}}`, or `{{request}}`. Missing values render empty.
- **Untrusted input protection**: Placeholder values are wrapped in `<webhook-data-…>` tags, and `$`/`@`/leading `/` tokens are neutralized so untrusted payloads can't invoke skills or commands.
- **Signatures** (web/desktop setup): Enable **Require signature** to verify HMAC signatures (for GitHub, keep `x-hub-signature-256`, hex, and `sha256=` prefix with the same secret and `application/json`).
- **Filters**: Add conditions (using paths without braces, e.g. `headers.x-github-event` equals `pull_request`, or `body.action` is one of `opened, reopened`). All filters must match; non-matching requests are logged as **Filtered**.
- **Deduplication & coalescing**: Set a **Duplicate request key** (e.g. `{{headers.delivery-id}}`; ignores repeats for 7 days) or a **Coalesce key** with a 10–3600s window (default 120s; runs once with the latest payload when the window closes). Coalesced updates are rate-limited to 60/min (`HTTP 429`).
- **Offline delivery**: By default, offline environments return an error. Enable **Settings → Sharing & access → Hold webhooks while offline** to buffer T3 Connect webhooks for up to 24 hours, and optionally set **Skip requests older than** on the task.
- **Debugging**: Open **Deliveries** from a task's menu (web/desktop) to inspect recent payloads and rendered prompts.
