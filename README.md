# Jen's Personal Dashboard

A cross-device personal dashboard for capturing tasks, keeping revenue work visible, tracking home goals, and sending dated items to Google Calendar/Fantastical.

## Run Locally

```bash
npm install
npm run dev
```

Without Supabase keys, the app runs in local demo mode using browser storage.
With Supabase keys, every device using the dashboard link reads and writes the
same shared dashboard. There is no sign-in flow.

## Connect Supabase

1. Create a separate Supabase project.
2. Run `supabase/schema.sql` in that project's SQL editor.
3. Copy `.env.example` to `.env.local`.
4. Add your project URL and publishable key from the Supabase Connect panel.
5. Restart the dev server.

For an existing dashboard project that already has `dashboard_tasks`, run
`supabase/shared-dashboard-migration.sql` once in the Supabase SQL editor.

The table uses row-level security to limit browser writes to the shared
`jen-dashboard` sync space. This is intentionally link-based shared sync: anyone
with the dashboard URL can use the same task board.

## Calendar Flow

The current version stores due dates and opens a Google Calendar event template for dated tasks. Since Fantastical displays Google Calendar, those reminders can show up there once saved.

The app includes a Supabase Edge Function at `supabase/functions/create-calendar-event` so clicking Calendar can create the event directly. Configure these Supabase secrets before deploying the function:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` optional; defaults to `primary`

Deploy with:

```bash
supabase functions deploy create-calendar-event
```

If the function is not deployed or the secrets are missing, the dashboard falls back to opening the normal Google Calendar event template.
