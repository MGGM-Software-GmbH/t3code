# Usage and limits

Open **Usage** by clicking a weekly limit indicator in the sidebar or composer, from the command
palette, or by pressing `mod+u` on web and desktop when the terminal is not focused. Press it
again to close Usage. Customize **Usage: Toggle** in **Settings → Keybindings**.
Track token usage, cache hit rates, estimated API-equivalent costs, and pooled subscription quotas across all connected environments.

- **Open Usage**: Click **Usage** in the sidebar, press `mod+u` (web/desktop outside terminals), or pick **Usage** on mobile.
- **Quick shortcuts** (web/desktop on Usage): `C` (Cost), `T` (Tokens), `L` (Limits), `mod+Shift+1/2/3/4` (24h / 7d / 30d / 90d), `Esc` (back).

## Understand your usage

Usage aggregates history across Codex, Claude Code, Grok Build, OpenCode, Antigravity, Pi, Muse Code, and Cursor from your selected environments. Estimates reflect API-equivalent rates (not your subscription bill); **Premium** shows Fast/Ultrafast surcharge, and **Other** shows unsplit provider-reported costs.

- **Retention**: Servers keep scanned usage history for **92 days** by default (preserving Claude history after Claude's 30-day cleanup). Change `usageHistoryRetentionDays` in `<t3-home>/userdata/settings.json` (e.g. `365` or `"unlimited"`; views show up to 90 days).
- **Custom data directories**: Honors `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GROK_HOME`, `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR`, `OPENCODE_DATA_DIR`, `ANTIGRAVITY_DATA_DIR`, and `XDG_DATA_HOME` (Muse). Use absolute or `~/` paths. Set `T3CODE_HOST_ID` to pin a container's host identity.
- **Exclusions**: Codex and Claude Code 2.0.63+ text-generation runs (titles, commits, PR text, review guides) and Grok turns without a saved completed-turn record are not included.

## Custom model prices and filtering

- **Custom prices & model mapping**: Open the environment dropdown on **Usage → Model prices** (or click **Set price** on an unpriced model) to set USD per million input/output/cache tokens, or set **Map to** to merge a preview/alias model ID into a target model's totals.
- **Filter models**: Add `usageModelFilter` to `<t3-home>/userdata/settings.json` (applied before **Map to**):

```json
{
  "usageModelFilter": {
    "include": [{ "provider": "claude", "model": "orbit-1" }, { "model": "orbit-2" }],
    "exclude": [{ "model": "drift-9" }]
  }
}
```

## Subscription limits

**Usage → Limits** pools subscription quotas per provider across connected environments and hubs (deduplicating the same account signed in on multiple machines).

For Codex CLI accounts, **Settings → MGGM → Redeem expiring banked resets** is enabled by default.
The server checks every minute and attempts to redeem credits during their last hour before expiry.
In the model picker, **Auto-redeem at 0%** can also redeem a credit when an account's overall weekly
allowance is exhausted; this option is off by default. Both settings apply to Codex accounts on
the selected environment and work with the picker closed while the server is running. Missing or
unavailable limits do not trigger a reset. Hub accounts and managed ChatGPT sign-ins are excluded.
Codex decides whether there is usage to reset; failed attempts are logged without replacing a thread.

The weekly indicators in the sidebar and next to the composer's access selector show the remaining
seven-day allowance across accounts and for the selected account. Antigravity does not report
subscription limits over ACP, so T3 does not read its limits or renew its login for quota checks.
Clicking any weekly limit indicator opens **Usage → Limits** directly, replacing a
separate Usage button under the thread list. The combined percentage weights
Codex accounts by their included plan allowance: Plus and Business Standard (formerly Team) count
as 1, Pro 100 and Business Premium as 10, Pro 200 as 20, and Pro 500 as 50. These are allowance
ratios, not subscription-price ratios. A combined percentage is unavailable when reporting accounts
have unknown or incomparable plan capacities; their individual readings remain in the details.
Hover or focus an indicator for account details, the regular reset time in your local time zone,
and when the balance was checked. Click to
open Usage. On touch screens, tap either indicator to read these details, then choose **Usage details**.
A question mark means no account-wide weekly allowance was reported; other time windows
and model-specific quotas are not substituted. ACP Registry agents such as GitHub Copilot show
no weekly indicator in the composer or model picker unless they report a weekly allowance.
Their monthly subscriptions are not treated as weekly quotas. These indicators reuse cached
snapshots and provider updates without additional polling. A passed reset does not assume a fresh
balance before the provider reports it.

The inner ring has seven day segments showing elapsed time in the weekly period. For several
accounts it shows the average of reported periods, independently of the remaining allowance.
The `+N` below the percentage is the number of banked resets reported for that account, or the
sum across distinct accounts in the sidebar. Missing credit counts are identified in the details
and are not assumed to be zero. The details also show the next reported credit expiry.
When it is within the next 120 hours, the expiry and banked count turn orange. In a Codex thread,
the banked count is blue while **Auto-redeem at 0%** is enabled, including when credits expire soon.

The **Codex reset forecast** beside the combined weekly indicator estimates the chance of an
additional reset within 24 hours. Its details include the near-term estimate, uncertainty range,
and a link to [LunarWerx Codex Forecast](https://codex.lunarwerx.com/). These are third-party
statistical estimates, not guaranteed resets or your account's regular rollover time. On touch
screens, tap the gauge to read the forecast, then choose **Open Codex Forecast** to visit its source.
Forecasts refresh every 60 minutes, with one shared cache per T3 server across clients. The details
show the forecast's original timestamp and time since the last reported additional reset. Resets
less than eight hours old are highlighted in green. Both usage indicators show local timestamps
with German weekdays and numeric dates. Failed requests and snapshots already stale on retrieval show `?`.

- **In chat**: Run `/usage-limits` in the composer to view the current model's snapshot without running the agent, or enable **Settings → Appearance → Thread details → Usage limits** (web/desktop).
- **Reset credits**: Click an account segment/row to inspect plan details and redeem banked Codex/Claude reset credits via **Use reset** (Claude resets unavailable on macOS Keychain logins).
- **Provider notes**:
  - **OpenCode**: OpenCode 2 servers with usage reporting show Go allowances and Console budgets for the connected workspace. Local servers can also report Go usage from a Go API key (`OPENCODE_API_KEY`).
  - **Cursor**: Reports monthly Auto + API quotas via `CURSOR_AUTH_TOKEN` or default-endpoint sign-in/`CURSOR_API_KEY`.
  - **Grok**: Reports billing-period quotas for `grok login` (not `XAI_API_KEY`).
  - **Muse Code**: Reports session/weekly limits after running in a thread (not persisted across restarts).
  - Pure API-key accounts generally do not report subscription limits.
- **Mobile widget**: Add the **Subscription usage** widget on iOS or Android to monitor Codex and Claude quotas from your home screen.

## Start a fresh Codex week automatically

**Settings → Providers → Codex → Automatically start weekly window** is enabled by default
for each CLI account. T3 checks hourly, even with no browser open. When fresh limits report an
unused seven-day window, it sends a brief read-only task using GPT-5.6 Luna to start that period
and confirms that the reset time has stopped moving. This uses a small amount of the account's
quota and does not redeem banked resets or change a thread's model.

The account must have an existing Codex CLI login and report weekly limits. T3 uses that
account's configured profile, including a shadow home when configured. Managed ChatGPT
connections are not supported. Turn the setting off for accounts you want to leave unused.

## Connect a CLIProxyAPI hub

Open **Settings → Providers → Usage providers → Add hub**, choose the environment, and enter the hub URL and management key. Pools Codex, Claude, and Grok accounts under **Usage → Limits** (including Codex **Use reset**). Configure the provider's endpoint to the same URL if you want threads to display that hub's limits.

## Connect an HTTP quota source

Open **Settings → Providers → Usage providers → Add HTTP source** with a GET endpoint (and optional bearer token) returning:

```json
{
  "version": 1,
  "accounts": [
    {
      "id": "primary",
      "label": "My coding plan",
      "providerInstanceId": "work-codex",
      "windows": [
        {
          "id": "monthly",
          "kind": "monthly",
          "label": "Monthly budget",
          "usedPercent": 35,
          "resetsAt": "2026-12-01T00:00:00Z"
        }
      ]
    }
  ]
}
```

`kind` is `session`, `weekly`, `monthly`, or `other`. Setting `providerInstanceId` binds the quota windows to that instance's thread details card.
