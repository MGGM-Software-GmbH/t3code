# Secrets

Keep credentials in 1Password instead of storing raw values in T3 Code, and let agents request one-off secrets in a private card instead of chat history.

> Note: **Settings → Secrets** is in preview and may not appear in every build. In-thread secret request cards from agents work everywhere.

## Connect 1Password

Install and sign in to the [1Password CLI](https://developer.1password.com/docs/cli/) (`op`) on the **T3 Code server machine**. On headless or remote servers, use a [1Password service account](./secrets-1password-service-account.md) or [1Password Connect](./secrets-1password-connect.md) so `op` doesn't wait for desktop approval.

1. Open **Settings → Secrets → Add provider** (configured per environment).
2. Enter a name and the 1Password account shorthand, sign-in address (without `https://`), or ID from `op account list`.

## Use secret references

Credential fields in Settings (provider env vars, source control tokens, usage keys, device host tokens) include a source picker: choose **Value** for a literal value or select your 1Password provider and paste a reference like `op://vault/item/field`.

- Click the check button to verify a reference immediately.
- T3 Code reads secrets on demand (e.g. when starting a provider). If 1Password is locked, unlock it on the server and click **Refresh** in **Settings → Providers**.
- Removing a secret provider clears fields referencing it in T3 Code without touching 1Password.

## Browseranmeldung mit pd-secrets im MGGM-Fork

Unter **Einstellungen → MGGM → pd-secrets** erlaubt der Schalter
**Browseranmeldung über pd-secrets erlauben** dem Agenten, Loginfelder mit einem
vorhandenen Zugang zu befüllen. Die Freigabe gilt für die gewählte Umgebung und
ist standardmäßig ausgeschaltet. Die Anmeldung bei pd-secrets erfolgt weiterhin
über das Schlüsselsymbol.

Ein Auftrag wie „Melde Dich unter https://ops.mggm.de mit OPS_LOKAL an“ genügt.
Der Zugang benötigt die vorhandenen Zuordnungen `OPS_LOKAL_USERNAME` und
`OPS_LOKAL_PASSWORD` in `~/.claude/.env`. Weitere Zugangsdialoge oder gespeicherte
Kennwörter in T3 sind nicht erforderlich.

Zuordnungen dürfen `${VAR}` und `${VAR:-Standardwert}` verwenden. T3 löst diese
Verweise ausschließlich aus derselben Mappingdatei auf, auch bei verschachtelten
Variablenverweisen. Fehlende und zyklische Verweise werden abgewiesen.

Die erlaubte Origin wird aus dem URL-Feld desselben Password-Depot-Eintrags
abgeleitet. Eine dort gespeicherte Login-URL darf einen Pfad enthalten; verglichen
werden Protokoll, Host und Port. Der Werkzeugparameter `expectedOrigin` enthält
keinen Pfad und keinen abschließenden Schrägstrich. Ohne nutzbares URL-Feld oder
bei einer abweichenden Origin verweigert der Server den Abruf von Benutzername
und Kennwort. Die beiden Zugangszuordnungen müssen auf denselben Depot-Eintrag
verweisen. Eine zusätzliche Origin-Zuordnung in der Mappingdatei ist nicht nötig.
`pd-secrets` muss auch dessen URL-Feld im Cache haben. Fehlt es, beim vorhandenen
`pd-secrets config` die Attribute `username,password,url` auswählen und den Cache
erneuern. T3 meldet diesen fehlenden Zugriff ausdrücklich.
Ein getrennter oder abgelaufener Cache und eine Zeitüberschreitung werden gesondert
gemeldet; sie gelten nicht als fehlendes URL-Feld.
Klartextzuordnungen und lediglich geerbte Umgebungsvariablen werden abgewiesen.

Kennwörter werden intern über einen Prozesskanal übertragen und
nicht als Toolargument, Gesprächsnachricht oder temporäre Datei abgelegt.
Die Befüllung setzt Vertrauen in den beauftragten Agenten und die Loginseite
voraus. Beide können die ausgefüllten Werte lesen. Das gilt auch für zuvor auf
der Seite installierte Ereignisbehandler und für spätere Browseraktionen wie
`preview_evaluate`. Die Funktion schützt vor einer versehentlichen Übergabe im
Toolaufruf, isoliert Kennwörter aber nicht gegenüber dem Agenten oder der Seite.
Die Aktion ist für den Serverbrowser verfügbar, berücksichtigt die Tabsteuerung
und verweigert fremde Domains sowie unverschlüsseltes HTTP außerhalb von Loopback.

## When an agent asks for a secret

When an agent calls `request_secret`, T3 Code displays a private card in the thread (web, desktop, and mobile) instead of asking you to paste into chat.

- Enter a value (or pick a 1Password reference if configured and permitted) and click **Save securely**, or **Decline**.
- Values never appear in conversation history. For T3 tools, the secret is passed directly without exposing it to the agent; for shell commands, the card tells you that the value is written to a private temporary file readable by the agent's commands for ~24 hours.
