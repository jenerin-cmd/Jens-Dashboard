import type { DashboardTask } from './types'
import { supabase } from './supabase'

function compactGoogleDate(value: string) {
  return value.replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}/, '')
}

function compactGoogleDay(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function buildGoogleCalendarUrl(task: DashboardTask) {
  const start = task.due_at ? new Date(task.due_at) : new Date()
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  const dates = task.reminder_minutes
    ? `${compactGoogleDate(start.toISOString())}/${compactGoogleDate(end.toISOString())}`
    : `${compactGoogleDay(start)}/${compactGoogleDay(new Date(start.getTime() + 24 * 60 * 60 * 1000))}`
  const details = [
    task.notes,
    task.reminder_minutes
      ? `Reminder: ${task.reminder_minutes} minutes before`
      : null,
    'Created from Jen\'s Dashboard.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: task.title,
    details,
    dates,
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export async function createGoogleCalendarEvent(task: DashboardTask) {
  if (!supabase) {
    throw new Error('Supabase is not connected yet.')
  }

  const { data, error } = await supabase.functions.invoke('create-calendar-event', {
    body: {
      title: task.title,
      notes: task.notes,
      due_at: task.due_at,
      reminder_minutes: task.reminder_minutes,
    },
  })

  if (error) throw error
  return data as { htmlLink?: string }
}
