type CalendarRequest = {
  title?: string
  notes?: string | null
  due_at?: string | null
  reminder_minutes?: number | null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not configured.`)
  return value
}

function allDayValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function nextDay(date: Date) {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000)
}

async function getGoogleAccessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requiredEnv('GOOGLE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: requiredEnv('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error_description ?? data.error ?? 'Could not refresh Google token.')
  }

  return data.access_token as string
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = (await request.json()) as CalendarRequest
    if (!body.title?.trim()) throw new Error('Event title is required.')
    if (!body.due_at) throw new Error('Add a date before creating a calendar event.')

    const start = new Date(body.due_at)
    const hasReminder = Boolean(body.reminder_minutes)
    const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID') ?? 'primary'
    const accessToken = await getGoogleAccessToken()
    const event = hasReminder
      ? {
          summary: body.title.trim(),
          description: body.notes ?? 'Created from Jen\'s Dashboard.',
          start: { dateTime: start.toISOString() },
          end: { dateTime: new Date(start.getTime() + 30 * 60 * 1000).toISOString() },
          reminders: {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: body.reminder_minutes }],
          },
        }
      : {
          summary: body.title.trim(),
          description: body.notes ?? 'Created from Jen\'s Dashboard.',
          start: { date: allDayValue(start) },
          end: { date: allDayValue(nextDay(start)) },
        }

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    )
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message ?? 'Could not create Google Calendar event.')
    }

    return new Response(JSON.stringify({ id: data.id, htmlLink: data.htmlLink }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Could not create calendar event.',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
