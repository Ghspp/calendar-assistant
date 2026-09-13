# Voice Calendar Assistant

A Hebrew voice-controlled personal calendar assistant that schedules events in Google Calendar.
Zero recurring cost: a deterministic local parser instead of an LLM, the browser's built-in speech
API, and Google Calendar's free quota.

## Status

| Stage | Scope | State |
|---|---|---|
| 0 | Scaffold, RTL, Hebrew font, theming, injectable clock | Done |
| 1 | Hebrew command parser | Done |
| 2 | Validation, conflict detection, free-slot finder | Done |
| 3 | Google OAuth + Calendar integration | Done |
| 4 | Creating events from typed Hebrew, with reminders | Done |
| 5 | Voice input and spoken replies | Done |
| 6 | Multi-turn conversation for missing or ambiguous details | Done |
| 7 | Calendar questions and free-slot search (read-only) | Done |
| 8 | Editing and deleting, with match disambiguation | Done |
| 9 | Visual calendar with manual add and delete | Done |
| 10 | Installable PWA, offline shell, deployment | Done |

All ten stages are complete.

**The app can now create events in your real calendar.** It still cannot edit or delete them —
those arrive in Stage 8, together with the disambiguation rules that stop an ambiguous match being
deleted by accident.

An event is only ever written when all of the following hold: the command was understood, every
slot was filled, no hour was left ambiguous, and a freshly fetched view of that day showed no
conflict. If any of those fails, nothing is written and the assistant says why in Hebrew.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest
npm run build    # typecheck + production build
```

Google Calendar features need the one-time setup below. Everything else — the parser, the
conflict logic, the UI — works without it.

---

## Google Cloud setup (one time, free)

You need a Google Cloud project and an OAuth client. There is no billing involved: the Calendar
API's free quota is one million requests per day, and this app makes a handful.

### 1. Create a project

1. Go to <https://console.cloud.google.com/projectcreate>.
2. Name it anything (for example `voice-calendar`) and click **Create**.
3. Make sure it is the selected project in the top bar before continuing.

### 2. Enable the Google Calendar API

1. Go to **APIs & Services → Library**, or <https://console.cloud.google.com/apis/library>.
2. Search for **Google Calendar API** and open it.
3. Click **Enable**.

### 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** and click **Create**. (**Internal** only exists for Google Workspace
   organisations. External is correct for a personal Gmail account.)
3. Fill in the required fields — app name, your email as the user support email, your email as the
   developer contact. Nothing else is needed.
4. On the **Scopes** step (called **Data access** in the newer *Google Auth Platform* console),
   click **Add or remove scopes** and add:

   ```
   https://www.googleapis.com/auth/calendar.events
   ```

   This is the narrowest scope that permits creating an event — Google offers no finer-grained
   "create only" variant. It covers reading and writing events, and nothing else: it cannot touch
   calendar settings, sharing, or any calendar you have not granted.

   > **Upgrading from the Stage 3 read-only scope?** Replace
   > `calendar.events.readonly` with `calendar.events`. An existing grant does not cover the wider
   > scope, so Google will show the consent screen again on your next connect. That is expected. If
   > you get a `permission-denied` error when creating, click **נתק** in the app and connect again
   > to pick up the new grant.
5. On the **Test users** step, click **Add users** and add **your own Google account address**.
   This is the important step — without it you will get `access_denied` when you try to connect.
6. Finish the wizard. **Leave the publishing status as "Testing".** Do not click *Publish app*.

> **Why leave it in Testing?**
> Calendar scopes are classified as *sensitive*, so a published app would need to go through
> Google's verification review. In Testing status you can add up to 100 test users and use the app
> immediately with no review. The only cost is an *"Google hasn't verified this app"* interstitial
> the first time you connect — click **Advanced → Go to … (unsafe)** to continue. That warning is
> about Google not having reviewed *your own* app; it is expected here.

### 4. Create the OAuth client ID

1. Go to **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Name it anything.
5. Under **Authorized JavaScript origins**, click **Add URI** and add exactly:

   ```
   http://localhost:5173
   ```

   - No trailing slash.
   - `http`, not `https` — localhost is exempt from the secure-origin requirement.
   - The port must match the dev server. This project's Vite config pins port `5173`.
   - Add `http://127.0.0.1:5173` too if you ever open the app that way; Google treats it as a
     different origin from `localhost`.
   - When you later deploy to GitHub Pages, add that origin here as well, for example
     `https://<your-username>.github.io`.

6. **Leave "Authorized redirect URIs" empty.** This app uses the GIS token flow, which does not
   redirect. Adding one is harmless but unnecessary.
7. Click **Create** and copy the **Client ID**. It looks like
   `123456789012-abcdefghijklmnop.apps.googleusercontent.com`.

### 5. Put the client ID in your local env file

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```
VITE_GOOGLE_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
```

**Restart the dev server.** Vite only reads env files at startup.

`.env.local` is gitignored. The client ID is not a secret — it ships in the browser bundle and is
visible to anyone using the app — but it is specific to your project, so it does not belong in the
repository.

### 6. Try it

1. `npm run dev`, open <http://localhost:5173>.
2. Click **הצג כלי פיתוח — חיבור ליומן Google** at the bottom.
3. Click **התחבר ל-Google Calendar**, pick your account, and click through the unverified-app
   warning.
4. Pick a date and click **טען את אירועי היום הזה**.

Then try creating something from the main screen:

```
תקבע לי פגישה עם דניאל מחר בשש בערב לשעה
```

The assistant should answer `קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00.` and offer a link to the
event. Run the same command twice and the second attempt will be refused as a conflict — nothing
is written.

### Troubleshooting

| Symptom | Cause |
|---|---|
| Panel says **לא מוגדר** | `VITE_GOOGLE_CLIENT_ID` is missing, or the dev server was not restarted after editing `.env.local`. |
| `Error 400: redirect_uri_mismatch` or `origin_mismatch` | The **Authorized JavaScript origin** does not exactly match the URL in your address bar. Check scheme, host and port, and that there is no trailing slash. |
| `access_denied` immediately | Your Google account is not in the **Test users** list on the consent screen. |
| "Google hasn't verified this app" | Expected in Testing status. Click **Advanced → Go to … (unsafe)**. |
| **נדרשת התחברות ל-Google Calendar** after a while | The access token expired (about an hour). Click connect again. |
| **אין הרשאה לקרוא את היומן** when creating | The grant is still the old read-only scope. Disconnect and connect again to consent to `calendar.events`. |
| Nothing happens when connecting | A popup blocker, or a content blocker preventing `accounts.google.com/gsi/client` from loading. |
| **No spoken reply on a phone** | Mobile browsers refuse to speak unless the page has already spoken once from a direct tap. **Press בדוק קול once per session** and replies become audible. The app primes the engine automatically on the microphone button, but a silent priming utterance is not always enough — an audible one from a real tap always is. |
| Spoken reply works on desktop but not mobile | Same cause as above. Desktop Chrome does not enforce the gesture requirement. |

---

## Deploying to GitHub Pages

**This is what makes voice work on a phone.** The Web Speech API refuses to start outside a secure
context, so opening the dev server over a LAN address such as `http://192.168.1.119:5173` loads the
page but leaves the microphone dead. GitHub Pages provides HTTPS for free and fixes that.

Everything needed is already in the repository — `.github/workflows/deploy.yml` builds, runs the
tests, and publishes. What is left is yours to do once.

### 1. Put the project on GitHub

```bash
git init
git add .
git commit -m "Voice calendar assistant"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo>.git
git push -u origin main
```

`.env.local` is gitignored, so your client id does not go up with it.

### 2. Turn on Pages

Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 3. Add the client id as a repository variable

Repository **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Name | Value |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | your `…apps.googleusercontent.com` id |

A *variable*, not a secret: the client id ships in the browser bundle and is not confidential. It
lives here only because it is specific to your Google Cloud project.

### 4. Authorise the new origin in Google Cloud

This step is easy to forget and the app will not connect without it.

**Google Auth Platform → Clients →** your OAuth client **→ Authorized JavaScript origins → Add URI**:

```
https://<your-username>.github.io
```

The origin is the host only — **no repository path, no trailing slash**. Keep
`http://localhost:5173` in the list as well so local development keeps working.

### 5. Push, and open it on your phone

The workflow runs on every push to `main`. When it finishes, the site is at
`https://<your-username>.github.io/<repo>/`.

Open it on the phone, tap the microphone, allow the permission — and it will work, because the page
is now served over HTTPS.

### 6. Install it to the home screen

The app offers an **התקן** button when Chrome makes one available; otherwise use Chrome's menu →
*Add to Home screen*. Installed, it opens full screen with no address bar and starts instantly from
the cached shell.

---

## Offline behaviour

The app shell — HTML, CSS, JavaScript and the Hebrew font — is precached by a service worker, so the
app opens instantly and works offline as a shell.

**Calendar data is never cached.** Two reasons, and both are deliberate:

1. A cached agenda could say a slot is free when it is not, which is exactly how a double booking
   happens.
2. It is private data, and the fewer copies of it exist the better.

So when the network is down the app opens, says so plainly in Hebrew, and disables the microphone
and the composer rather than failing silently partway through a request.

---

## Architecture notes

```
Voice  →  Speech to text  →  Hebrew parser  →  Conversation state
                                    ↓
                            Structured event
                                    ↓
                               Validation          ← the safety gate
                                    ↓
                         Google Calendar (read)
                                    ↓
                           Conflict detection
                                    ↓
                             create / reject
```

The pieces that make decisions — the parser, the validator, the conflict detector and the
free-slot finder — are **pure functions**. They perform no I/O and never call `new Date()`; the
current instant is injected through a `Clock`. That is what makes the whole decision path testable
without a network or a wall clock.

Two rules that the code enforces rather than merely documents:

- **The parser never guesses AM/PM.** A bare Hebrew hour such as `בשש` is reported as ambiguous
  with both readings and no resolved value. The validator rejects any command with an open
  ambiguity, so an unanswered *"בבוקר או בערב?"* cannot become a booked event.
- **The parser never touches the calendar.** It emits data; application code validates it and runs
  conflict detection before anything is written.

All times are handled in `Asia/Jerusalem`. Wall-clock times are converted to absolute instants
exactly once, and every comparison after that is on instants — which is why the logic stays correct
across the DST change.

### The visual calendar

A second tab shows the calendar itself, so the app is usable without speaking: a day view
with an hour grid, and a week view as an agenda grouped by day. Tapping an empty hour opens a
form; tapping an event opens a sheet with a delete action.

The week view is an agenda rather than seven columns on purpose — a seven-column grid is
unreadable at phone width, and this app is phone-first.

**Manual actions are not a second code path.** A tapped create is assembled into an ordinary
command and run through the same `executeCommand` as a spoken one, so validation and conflict
detection apply identically. A tapped delete still asks for confirmation. The visual route gets
no weaker a guard than the spoken one.

### Editing and deleting

```
"תשנה את הפגישה עם דניאל מחר שתהיה עם אברהם"  →  renames, time untouched
"תעביר את הפגישה עם דניאל מחר ל-18:00"        →  moves, title untouched
"תבטל את הפגישה עם דניאל מחר"                  →  "למחוק את פגישה עם דניאל מחר בין 15:00 ל־16:00?"
```

**Deleting is the only operation that asks for confirmation.** Creating and renaming go
straight through; deleting does not, because a mistaken delete cannot be undone from inside this
app. An unclear answer re-asks — it is never read as consent.

Three rules apply to both editing and deleting:

- **Never act on an ambiguous match.** Zero matches is reported; more than one is listed and the
  user picks by ordinal (`השני`), number (`2`) or start time (`15:00`). The app never chooses.
- **Choosing is not consent.** Picking which event narrows it down; for a deletion a separate yes
  still authorises it.
- **Only the named field is sent.** A rename cannot disturb the time and a move cannot disturb the
  title, because the request carries only the field that changed.

A move re-checks conflicts against freshly fetched events, excluding the event being moved — an
event never conflicts with itself.

### Calendar questions

Alongside creating events, the assistant answers read-only questions. None of these can
write anything:

```
"מה יש לי מחר?"                   →  "מחר יש לך חוג כדורגל 17:00־18:00."
"אני פנוי מחר ב-17:30?"           →  "לא. מחר בין 17:30 ל־18:30 יש לך חוג כדורגל 17:00־18:00."
"מצא לי שעה פנויה של שעתיים מחר"  →  "מחר אתה פנוי בין 08:00 ל־17:00, בין 18:00 ל־22:00."
"מתי יש לי את הפגישה עם דניאל?"   →  "פגישה עם דניאל מחר בין 09:00 ל־10:00."
```

One deliberate asymmetry: **a question with an ambiguous hour is answered for both readings
rather than asking which was meant.**

```
"אני פנוי מחר בשש?"  →  "ב־06:00 אתה פנוי. ב־18:00 יש לך חוג כדורגל 17:00־18:00."
```

Creating still asks, because only one event can be booked and guessing would write the wrong
thing. Answering a question changes nothing, so reporting both readings is more useful than a
round trip — and it still never guesses which one was meant. **Reads answer both; writes ask.**

Day-part words narrow a free-slot search (`מחר בערב` searches 17:00–23:00), and free-slot
results use exactly the same exclusion rules as conflict detection, so the two can never
disagree about whether a slot is free.

### Letting the assistant choose the hour

```
"תקבע לי פגישה מחר בזמן הפנוי הראשון לשעה"
  →  "קבעתי פגישה מחר בין 08:00 ל־09:00."
```

The hour comes from the calendar rather than the utterance. That is not a guess about what
was meant — it is a computation that was explicitly asked for.

After a conflict the assistant offers an alternative, but never takes it:

```
"תקבע לי פגישה מחר ב-17:30 לשעה"
  →  "לא ניתן לקבוע … כי יש לך חוג כדורגל בין 17:00 ל־18:00. אתה פנוי ב־18:00. רוצה שאקבע שם?"
"כן"
  →  "קבעתי פגישה מחר בין 18:00 ל־19:00."
```

The offer is inert until accepted, and accepting re-runs the whole pipeline — the slot is
checked again against freshly fetched events rather than trusted from a moment earlier.

### Conversation

An incomplete request is finished over several turns:

```
"תקבע לי פגישה עם דניאל מחר"   →  "באיזו שעה לקבוע?"
"בשש"                           →  "בבוקר או בערב?"
"בערב"                          →  "ולכמה זמן?"
"לשעה"                          →  "קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00."
```

Three rules keep this from misfiring:

- **An answer never overwrites a slot that is already filled.** Settling the hour cannot
  disturb a date established two turns earlier.
- **A recognised command verb abandons the pending request.** Saying "תקבע לי אימון מחר" halfway
  through another request starts that one instead of being absorbed as an answer.
- **The request expires after three minutes**, so yesterday's abandoned half-request can never
  capture today's first words. Saying "עזוב" or "לא משנה" drops it immediately.

A multi-turn request is assembled into an ordinary command and goes through the same validator and
the same conflict check as a single-shot one. There is no shortcut to the calendar.

### Speech

Voice input uses the browser's **Web Speech API** with `he-IL`, and replies are spoken back
through `speechSynthesis`. Both are free, unlimited, and built into the browser.

Two limitations worth knowing, both surfaced in the UI rather than hidden:

- **Chrome and Edge only.** Firefox has no implementation at all; desktop Safari and iOS are
  partial and unreliable. When recognition is unavailable the microphone is disabled with a Hebrew
  explanation and the text field remains fully functional — the app never depends on speech.
- **It needs a secure context.** HTTPS or `localhost`. Opening the dev server over a plain LAN IP
  such as `http://192.168.1.119:5173` will load the page but the microphone will refuse to start.
  To test by voice on your phone before deploying, use a tunnel that provides HTTPS, or deploy to
  GitHub Pages.

Privacy: Chrome streams the audio to Google's servers for transcription. Calendar contents never
leave the device except to the Calendar API, and all parsing is local — but the raw voice clip is
not processed on-device. `SpeechProvider` is an interface, so an on-device Whisper provider could
be added later without touching the UI.

### Notifications

A PWA cannot schedule reliable background notifications. The Notification Triggers API never
shipped to stable Chrome, and Web Push needs a server to send the push — which this project
deliberately does not have.

So the app delegates. Every event it creates carries its own reminder (a popup ten minutes before),
and the **native Google Calendar app** on your phone fires a real OS notification at the right
time. No infrastructure, and it works while this app is closed. The reminder belongs to Google
Calendar rather than to us, which is precisely why it is dependable.

### Authentication model

Pure client-side: Google Identity Services issues an access token directly to the browser. There is
no backend and no client secret.

The token is held **in memory only**, never in `localStorage`, because it is a bearer credential and
storage would expose it to any XSS on the origin. Consequences worth knowing:

- A page reload needs a new token. A silent renewal is attempted first.
- The implicit flow issues no refresh token, so tokens last about an hour. Silent renewal usually
  works while your Google session is alive, but browser third-party-cookie restrictions mean it can
  fail, and you will occasionally need to click connect again.

All of this is contained in `src/services/calendar/auth.ts`. Nothing else in the codebase touches a
token, and the module could be swapped for a serverless refresh-token backend without changes
elsewhere.
