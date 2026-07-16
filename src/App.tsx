import {
  Banknote,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronRight,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  ClipboardList,
  Eraser,
  GripVertical,
  Home,
  Loader2,
  LogOut,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Target,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import './App.css'
import { buildGoogleCalendarUrl, createGoogleCalendarEvent } from './lib/calendar'
import { hasSupabaseConfig, supabase } from './lib/supabase'
import {
  addTask,
  clearDoneTasks,
  clearCompletedTasks,
  clearProjectTasks,
  copyCurrentSupabaseTasksToLocal,
  deleteTask,
  listTasks,
  restoreTasks,
  subscribeToTasks,
  syncLocalTasksToSupabase,
  updateTask,
} from './lib/store'
import type { AreaKey, DashboardTask, NewTaskInput, StoreMode } from './lib/types'

type AreaConfig = {
  key: AreaKey
  label: string
  short: string
  empty: string
  icon: typeof Target
}

const areas: AreaConfig[] = [
  {
    key: 'today',
    label: 'Today',
    short: 'Right now',
    empty: 'Nothing urgent. Add the next tiny move.',
    icon: Target,
  },
  {
    key: 'ukg',
    label: 'UKG To-Dos',
    short: 'Work queue',
    empty: 'Add the UKG things you want to knock out today.',
    icon: ClipboardList,
  },
  {
    key: 'admin',
    label: 'Admin',
    short: 'Life logistics',
    empty: 'Forms, calls, email, appointments, and paperwork.',
    icon: ClipboardList,
  },
  {
    key: 'home',
    label: 'Home Projects',
    short: 'House + rooms',
    empty: 'Office, Jordan\'s room, repairs, and organizing.',
    icon: Home,
  },
  {
    key: 'business',
    label: 'ClearDesk + App',
    short: 'Build and sell',
    empty: 'Leads, offers, ads, app work, and follow-ups live here.',
    icon: BriefcaseBusiness,
  },
  {
    key: 'money',
    label: 'Money Moves',
    short: 'Revenue first',
    empty: 'Put one thing here that can help money come in.',
    icon: Banknote,
  },
  {
    key: 'wishlist',
    label: 'Wishlist',
    short: 'Save for later',
    empty: 'The wants are allowed. We just give them a parking spot.',
    icon: Sparkles,
  },
]

const AUTH_COOLDOWN_KEY = 'jens-dashboard-auth-cooldown-until'
const AREA_ORDER_KEY = 'jens-dashboard-area-order-v1'
const WEATHER_LOCATION_KEY = 'jens-dashboard-weather-location'
const WEATHER_CACHE_KEY = 'jens-dashboard-weather-cache-v1'
const POMODORO_SECONDS = 25 * 60
const defaultAreaOrder = areas.map((item) => item.key)
const rightRailAreaKeys = new Set<AreaKey>(['home', 'money'])

type SyncUser = {
  email?: string | null
  is_anonymous?: boolean
}

function isCrossDeviceUser(user: SyncUser | null | undefined) {
  return Boolean(user?.email && !user.is_anonymous)
}

type WeatherState = {
  name: string
  temperature: number
  wind: number
  description: string
  code: number
}

type UndoAction = {
  label: string
  run: () => Promise<void>
}

function normalizeAreaOrder(value: unknown) {
  const parsed = Array.isArray(value) ? value : []
  const known = new Set(defaultAreaOrder)
  const ordered = parsed.filter(
    (item): item is AreaKey =>
      typeof item === 'string' && known.has(item as AreaKey),
  )

  return [...ordered, ...defaultAreaOrder.filter((item) => !ordered.includes(item))]
}

function readAreaOrder() {
  try {
    return normalizeAreaOrder(JSON.parse(localStorage.getItem(AREA_ORDER_KEY) ?? '[]'))
  } catch {
    return defaultAreaOrder
  }
}

function saveAreaOrder(order: AreaKey[]) {
  localStorage.setItem(AREA_ORDER_KEY, JSON.stringify(order))
}

function getSavedWeatherLocation() {
  return localStorage.getItem(WEATHER_LOCATION_KEY) ?? '77082'
}

function getCachedWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) ?? 'null') as
      | { weather: WeatherState; savedAt: number }
      | null
    if (!cached || Date.now() - cached.savedAt > 6 * 60 * 60 * 1000) return null
    return cached.weather
  } catch {
    return null
  }
}

function saveCachedWeather(weather: WeatherState) {
  localStorage.setItem(
    WEATHER_CACHE_KEY,
    JSON.stringify({ weather, savedAt: Date.now() }),
  )
}

function weatherCodeDescription(code: number) {
  if (code === 0) return 'Clear'
  if ([1, 2, 3].includes(code)) return 'Partly cloudy'
  if ([45, 48].includes(code)) return 'Fog'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
  if ([95, 96, 99].includes(code)) return 'Storms'
  return 'Weather'
}

function weatherIconForCode(code: number) {
  if (code === 0) return Sun
  if ([1, 2, 3].includes(code)) return CloudSun
  if ([45, 48].includes(code)) return CloudFog
  if ([51, 53, 55, 56, 57].includes(code)) return CloudDrizzle
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return CloudRain
  if ([71, 73, 75, 77, 85, 86].includes(code)) return CloudSnow
  if ([95, 96, 99].includes(code)) return CloudLightning
  return Cloud
}

function shortWeatherPlace(value: string) {
  return value.replace(/\s+\d{5}$/, '')
}

async function geocodeLocation(location: string) {
  const trimmed = location.trim()
  if (/^\d{5}$/.test(trimmed)) {
    try {
      const response = await fetch(`https://api.zippopotam.us/us/${trimmed}`)
      if (!response.ok) throw new Error('Could not find that ZIP code.')
      const data = await response.json()
      const place = data.places?.[0]
      if (!place) throw new Error('Could not find that ZIP code.')
      return {
        name: `${place['place name']}, ${place['state abbreviation']} ${trimmed}`,
        latitude: Number(place.latitude),
        longitude: Number(place.longitude),
      }
    } catch (caught) {
      if (trimmed === '77082') {
        return {
          name: 'Houston, TX 77082',
          latitude: 29.7223,
          longitude: -95.6285,
        }
      }
      throw caught
    }
  }

  const response = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(trimmed)}`,
  )
  if (!response.ok) throw new Error('Could not find that location.')
  const data = await response.json()
  const place = data.results?.[0]
  if (!place) throw new Error('Could not find that location.')
  return {
    name: [place.name, place.admin1].filter(Boolean).join(', '),
    latitude: place.latitude as number,
    longitude: place.longitude as number,
  }
}

function getWorkFocus(tasks: DashboardTask[]) {
  const active = tasks.filter((task) => task.status === 'active')
  const projectCounts = new Map<string, number>()

  for (const task of active) {
    const project =
      task.area === 'ukg' && task.notes
        ? task.notes
        : areas.find((item) => item.key === task.area)?.label ?? task.area
    projectCounts.set(project, (projectCounts.get(project) ?? 0) + 1)
  }

  return Array.from(projectCounts.entries()).sort((a, b) => b[1] - a[1])[0]
}

function currency(value?: number | null) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value ?? 0)
}

function fromDateParts(dateValue: string, timeValue: string) {
  if (!dateValue) return null

  const time = timeValue || '12:00'
  return new Date(`${dateValue}T${time}`).toISOString()
}

function formatDueDate(task: DashboardTask) {
  if (!task.due_at) return ''

  const date = new Date(task.due_at)
  if (!task.reminder_minutes) {
    return date.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getMonthDays(date: Date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingBlanks = firstDay.getDay()

  return [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]
}

function cleanChecklistItem(value: string) {
  return value
    .replace(/^\s*(?:[-*•]|\d+[.)]?)\s*/, '')
    .trim()
}

function isProjectHeader(value: string) {
  return /\bproject\b\s*:?\s*$/i.test(cleanChecklistItem(value))
}

function cleanProjectHeader(value: string) {
  return cleanChecklistItem(value).replace(/:\s*$/, '').trim()
}

function buildTaskInputs(
  text: string,
  selectedArea: AreaKey,
  dueAt: string | null,
  reminderMinutes: number | null,
) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (selectedArea !== 'ukg' || lines.length < 2) {
    return [
      {
        title: text.trim(),
        area: selectedArea,
        due_at: dueAt,
        reminder_minutes: reminderMinutes,
        priority:
          selectedArea === 'money' || selectedArea === 'business'
            ? 'high'
            : 'normal',
      } satisfies NewTaskInput,
    ]
  }

  const projectHeaderCount = lines.filter(isProjectHeader).length
  if (projectHeaderCount > 0) {
    const taskInputs: NewTaskInput[] = []
    let currentProject = 'General'

    for (const line of lines) {
      if (isProjectHeader(line)) {
        currentProject = cleanProjectHeader(line)
        continue
      }

      const title = cleanChecklistItem(line)
      if (!title) continue

      taskInputs.push({
        title,
        area: 'ukg',
        notes: currentProject,
        due_at: dueAt,
        reminder_minutes: reminderMinutes,
        priority: 'normal',
      })
    }

    if (taskInputs.length) {
      return taskInputs
    }
  }

  const [project, ...items] = lines
  const checklistItems = items.map(cleanChecklistItem).filter(Boolean)
  if (!checklistItems.length) {
    return [
      {
        title: project,
        area: 'ukg',
        due_at: dueAt,
        reminder_minutes: reminderMinutes,
        priority: 'normal',
      } satisfies NewTaskInput,
    ]
  }

  return checklistItems.map(
    (title) =>
      ({
        title,
        area: 'ukg',
        notes: project,
        due_at: dueAt,
        reminder_minutes: reminderMinutes,
        priority: 'normal',
      }) satisfies NewTaskInput,
  )
}

function getAuthCooldownSeconds() {
  const cooldownUntil = Number(localStorage.getItem(AUTH_COOLDOWN_KEY) ?? 0)
  if (!cooldownUntil) return 0

  const remainingMs = cooldownUntil - Date.now()
  if (remainingMs <= 0) {
    localStorage.removeItem(AUTH_COOLDOWN_KEY)
    return 0
  }

  return Math.ceil(remainingMs / 1000)
}

function saveAuthCooldown(seconds: number) {
  localStorage.setItem(AUTH_COOLDOWN_KEY, String(Date.now() + seconds * 1000))
}

function AuthPanel({
  syncNotice,
  onAuthChange,
}: {
  syncNotice: string
  onAuthChange: () => void
}) {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)

  async function refreshUser() {
    if (!supabase) return

    const { data } = await supabase.auth.getUser()
    const user = data.user
    setSignedInEmail(isCrossDeviceUser(user) ? user?.email ?? null : null)
  }

  useEffect(() => {
    refreshUser()
    setCooldownSeconds(getAuthCooldownSeconds())

    const authSubscription = supabase?.auth.onAuthStateChange(() => {
      refreshUser()
    })

    return () => {
      authSubscription?.data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined

    const timer = window.setTimeout(() => {
      setCooldownSeconds(getAuthCooldownSeconds())
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [cooldownSeconds])

  function startCooldown(seconds: number) {
    saveAuthCooldown(seconds)
    setCooldownSeconds(seconds)
  }

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedEmail = email.trim()
    if (!supabase) {
      setMessage('Supabase is not connected yet.')
      return
    }
    if (!trimmedEmail) {
      setMessage('Enter your email first.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setMessage('Enter a valid email address.')
      return
    }
    const activeCooldown = getAuthCooldownSeconds()
    if (activeCooldown > 0) {
      setCooldownSeconds(activeCooldown)
      setMessage(`Wait ${activeCooldown}s before requesting another sign-in link.`)
      return
    }

    setBusy(true)
    setMessage(`Sending a sign-in link to ${trimmedEmail}...`)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: { emailRedirectTo: window.location.origin },
      })

      if (error) {
        const isRateLimit = error.message.toLowerCase().includes('rate limit')
        setMessage(
          isRateLimit
            ? 'Supabase is rate-limiting sign-in emails. Wait a few minutes, then try again.'
            : error.message,
        )
        if (isRateLimit) startCooldown(300)
        return
      }

      setMessage('Check your email for the sign-in link.')
      startCooldown(60)
      onAuthChange()
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : 'Could not send the sign-in link.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return

    setBusy(true)
    setMessage('')

    try {
      const { error } = await supabase.auth.signOut()
      setMessage(error ? error.message : 'Signed out.')
      setSignedInEmail(null)
      onAuthChange()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Could not sign out.')
    } finally {
      setBusy(false)
    }
  }

  const isSynced = Boolean(signedInEmail)

  return (
    <div className="auth-panel">
      <div>
        <strong>Supabase sync</strong>
        <span>
          {signedInEmail
            ? `Signed in as ${signedInEmail}. Syncing across devices.`
            : syncNotice
              ? syncNotice
            : hasSupabaseConfig
              ? 'Sign in to sync across devices.'
              : 'Add Supabase keys to enable cross-device sync.'}
        </span>
      </div>
      {isSynced ? (
        <button type="button" className="secondary-button" onClick={signOut} disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <LogOut size={16} />}
          Sign out
        </button>
      ) : hasSupabaseConfig ? (
        <form className="auth-form" onSubmit={sendMagicLink} noValidate>
          <input
            type="email"
            value={email}
            placeholder="Email for magic link"
            autoComplete="email"
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            type="submit"
            disabled={busy || cooldownSeconds > 0}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <Bell size={16} />}
            {busy
              ? 'Sending...'
              : cooldownSeconds > 0
                ? `Try again in ${cooldownSeconds}s`
                : 'Sign in'}
          </button>
        </form>
      ) : null}
      {message ? <p>{message}</p> : null}
    </div>
  )
}

function PomodoroWidget() {
  const [secondsLeft, setSecondsLeft] = useState(POMODORO_SECONDS)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          setRunning(false)
          return 0
        }
        return value - 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [running])

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, '0')

  return (
    <div className="top-widget pomodoro-widget">
      <span>Pomodoro</span>
      <strong>{minutes}:{seconds}</strong>
      <div>
        <button type="button" onClick={() => setRunning((value) => !value)}>
          {running ? <Pause size={16} /> : <Play size={16} />}
          {running ? 'Pause' : 'Start'}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setRunning(false)
            setSecondsLeft(POMODORO_SECONDS)
          }}
          aria-label="Reset Pomodoro"
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  )
}

function WeatherWidget() {
  const [location, setLocation] = useState(getSavedWeatherLocation)
  const [draftLocation, setDraftLocation] = useState(getSavedWeatherLocation)
  const [weather, setWeather] = useState<WeatherState | null>(getCachedWeather)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadWeather() {
      setLoading(true)
      setError('')
      try {
        const place = await geocodeLocation(location)
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`,
        )
        if (!response.ok) throw new Error('Could not load weather.')
        const data = await response.json()
        if (cancelled) return
        const nextWeather = {
          name: place.name,
          temperature: Math.round(data.current.temperature_2m),
          wind: Math.round(data.current.wind_speed_10m),
          description: weatherCodeDescription(data.current.weather_code),
          code: data.current.weather_code,
        }
        setWeather(nextWeather)
        saveCachedWeather(nextWeather)
      } catch (caught) {
        if (!cancelled) {
          setWeather((current) => current ?? getCachedWeather())
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not refresh weather right now.',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadWeather()
    return () => {
      cancelled = true
    }
  }, [location])

  function saveLocation(event: FormEvent) {
    event.preventDefault()
    if (!draftLocation.trim()) return
    localStorage.setItem(WEATHER_LOCATION_KEY, draftLocation.trim())
    setLocation(draftLocation.trim())
  }

  const WeatherIcon = weather ? weatherIconForCode(weather.code) : CloudSun

  return (
    <div className="top-widget weather-widget">
      <span>Weather</span>
      <div className="weather-current">
        {weather ? (
          <strong>{weather.temperature}°</strong>
        ) : (
          <strong>{loading ? '...' : '--'}</strong>
        )}
        <WeatherIcon size={54} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <p>
        {weather
          ? `${weather.description} in ${shortWeatherPlace(weather.name)}. Wind ${weather.wind} mph.`
          : error || 'Loading weather.'}
      </p>
      <form onSubmit={saveLocation}>
        <input
          value={draftLocation}
          onChange={(event) => setDraftLocation(event.target.value)}
          aria-label="Weather location"
        />
        <button type="submit">Set</button>
      </form>
    </div>
  )
}

function MonthCalendar() {
  const today = new Date()
  const monthLabel = today.toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  })
  const currentDay = today.getDate()
  const days = getMonthDays(today)

  return (
    <div className="month-calendar-panel">
      <div className="panel-heading">
        <span>
          <CalendarDays size={17} />
          <strong>{monthLabel}</strong>
        </span>
        <small>Today is highlighted</small>
      </div>
      <div className="month-grid" aria-label={`${monthLabel} calendar`}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <span className="weekday" key={`${day}-${index}`}>
            {day}
          </span>
        ))}
        {days.map((day, index) =>
          day ? (
            <span
              className={day === currentDay ? 'month-day today' : 'month-day'}
              key={`${monthLabel}-${day}`}
            >
              {day}
            </span>
          ) : (
            <span className="month-day blank" key={`blank-${index}`} />
          ),
        )}
      </div>
    </div>
  )
}

function TaskCard({
  task,
  hideNotes,
  isTaskDragging,
  onPatchTask,
  onDeleteTask,
  onTaskDragStart,
  onTaskDragEnd,
}: {
  task: DashboardTask
  hideNotes?: boolean
  isTaskDragging: boolean
  onPatchTask: (
    task: DashboardTask,
    patch: Partial<DashboardTask>,
    label: string,
  ) => Promise<void>
  onDeleteTask: (task: DashboardTask) => Promise<void>
  onTaskDragStart: (taskId: string) => void
  onTaskDragEnd: () => void
}) {
  const [cost, setCost] = useState(task.cost_estimate?.toString() ?? '')
  const [saved, setSaved] = useState(task.saved_amount?.toString() ?? '')
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [calendarMessage, setCalendarMessage] = useState('')
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [projectDraft, setProjectDraft] = useState(task.notes?.trim() || 'General')
  const progress =
    task.cost_estimate && task.cost_estimate > 0
      ? Math.min(((task.saved_amount ?? 0) / task.cost_estimate) * 100, 100)
      : 0

  async function saveMoney() {
    await onPatchTask(task, {
      cost_estimate: cost ? Number(cost) : null,
      saved_amount: saved ? Number(saved) : null,
    }, 'Undo money update')
  }

  async function markDone() {
    await onPatchTask(task, {
      status: task.status === 'done' ? 'active' : 'done',
    }, task.status === 'done' ? 'Undo reopen task' : 'Undo complete task')
  }

  async function saveTitle(event: FormEvent) {
    event.preventDefault()
    const nextTitle = titleDraft.trim()
    if (!nextTitle) return

    await onPatchTask(task, { title: nextTitle }, 'Undo title edit')
    setEditing(false)
  }

  async function saveProject() {
    if (task.area !== 'ukg') return

    const nextProject = projectDraft.trim() || 'General'
    setProjectDraft(nextProject)
    await onPatchTask(task, { notes: nextProject }, 'Undo project change')
  }

  async function createCalendarEvent() {
    if (!task.due_at) return
    setCalendarBusy(true)
    setCalendarMessage('')

    try {
      const event = await createGoogleCalendarEvent(task)
      setCalendarMessage('Added to Google Calendar.')
      if (event.htmlLink) window.open(event.htmlLink, '_blank', 'noreferrer')
    } catch (caught) {
      setCalendarMessage(
        caught instanceof Error
          ? `Calendar backend not ready: ${caught.message}`
          : 'Calendar backend is not ready.',
      )
      window.open(buildGoogleCalendarUrl(task), '_blank', 'noreferrer')
    } finally {
      setCalendarBusy(false)
    }
  }

  return (
    <article
      className={`task-card ${task.status === 'done' ? 'done' : ''} ${isTaskDragging ? 'task-dragging' : ''}`}
      draggable
      onDragStart={(event) => {
        event.stopPropagation()
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.id)
        onTaskDragStart(task.id)
      }}
      onDragEnd={onTaskDragEnd}
    >
      <div className="task-main">
        <button
          type="button"
          className={`icon-button check-button ${task.status === 'done' ? 'checked' : ''}`}
          onClick={markDone}
          aria-label="Toggle complete"
        >
          {task.status === 'done' ? <Check size={16} /> : null}
        </button>
        <div>
          {editing ? (
            <form className="task-edit-form" onSubmit={saveTitle}>
              <input
                value={titleDraft}
                autoFocus
                onChange={(event) => setTitleDraft(event.target.value)}
              />
              <button type="submit" className="icon-button" aria-label="Save task title">
                <Check size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Cancel edit"
                onClick={() => {
                  setTitleDraft(task.title)
                  setEditing(false)
                }}
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <div className="task-title-row">
              <h3>{task.title}</h3>
              {task.area === 'ukg' ? (
                <button
                  type="button"
                  className="edit-task-button"
                  aria-label="Edit UKG to-do"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} />
                </button>
              ) : null}
            </div>
          )}
          {task.notes && !hideNotes ? <p>{task.notes}</p> : null}
          {task.due_at ? (
            <span className="due-pill">
              <Bell size={13} />
              {formatDueDate(task)}
            </span>
          ) : null}
        </div>
      </div>

      {(task.area === 'home' || task.area === 'wishlist') && (
        <div className="money-editor">
          <label>
            Cost
            <input
              inputMode="decimal"
              value={cost}
              placeholder="$"
              onBlur={saveMoney}
              onChange={(event) => setCost(event.target.value)}
            />
          </label>
          <label>
            Saved
            <input
              inputMode="decimal"
              value={saved}
              placeholder="$"
              onBlur={saveMoney}
              onChange={(event) => setSaved(event.target.value)}
            />
          </label>
          {task.cost_estimate ? (
            <div className="progress-wrap">
              <span>
                {currency(task.saved_amount)} / {currency(task.cost_estimate)}
              </span>
              <div className="progress-bar">
                <i style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="task-actions">
        {task.area === 'ukg' ? (
          <label className="project-task-control">
            <span>Project</span>
            <input
              value={projectDraft}
              onBlur={saveProject}
              onChange={(event) => setProjectDraft(event.target.value)}
              aria-label="UKG project"
            />
          </label>
        ) : null}
        {task.due_at ? (
          <button
            type="button"
            className="text-button"
            onClick={createCalendarEvent}
            disabled={calendarBusy}
          >
            {calendarBusy ? <Loader2 className="spin" size={15} /> : <CalendarPlus size={15} />}
            {calendarBusy ? 'Adding' : 'Calendar'}
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button"
          onClick={async () => {
            await onDeleteTask(task)
          }}
          aria-label="Delete task"
        >
          <Trash2 size={15} />
        </button>
      </div>
      {calendarMessage ? <p className="task-message">{calendarMessage}</p> : null}
    </article>
  )
}

function AreaSection({
  area,
  tasks,
  isDragging,
  isTaskDropTarget,
  onClearCompleted,
  onClearProject,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  draggedTaskId,
  onPatchTask,
  onDeleteTask,
  onTaskDragStart,
  onTaskDragEnd,
  onTaskDrop,
  onProjectTaskDrop,
}: {
  area: AreaConfig
  tasks: DashboardTask[]
  isDragging: boolean
  isTaskDropTarget: boolean
  onClearCompleted: () => void
  onClearProject: (project: string) => void
  onDragStart: (area: AreaKey) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (area: AreaKey) => void
  onDragEnd: () => void
  draggedTaskId: string | null
  onPatchTask: (
    task: DashboardTask,
    patch: Partial<DashboardTask>,
    label: string,
  ) => Promise<void>
  onDeleteTask: (task: DashboardTask) => Promise<void>
  onTaskDragStart: (taskId: string) => void
  onTaskDragEnd: () => void
  onTaskDrop: (area: AreaKey) => void
  onProjectTaskDrop: (project: string) => void
}) {
  const Icon = area.icon
  const doneCount = tasks.filter((task) => task.status === 'done').length
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(),
  )
  const ukgProjects = useMemo(() => {
    if (area.key !== 'ukg') return []

    const projects = new Map<string, DashboardTask[]>()
    for (const task of tasks) {
      const project = task.notes?.trim() || 'General'
      projects.set(project, [...(projects.get(project) ?? []), task])
    }

    return Array.from(projects, ([project, projectTasks]) => ({
      project,
      tasks: projectTasks,
    }))
  }, [area.key, tasks])
  const toggleProject = (project: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current)
      if (next.has(project)) {
        next.delete(project)
      } else {
        next.add(project)
      }
      return next
    })
  }

  return (
    <section
      className={`area-section area-${area.key} ${isDragging ? 'dragging' : ''} ${isTaskDropTarget ? 'task-drop-target' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        if (draggedTaskId) {
          event.dataTransfer.dropEffect = 'move'
          return
        }
        onDragOver(event)
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (draggedTaskId) {
          onTaskDrop(area.key)
          return
        }
        onDrop(area.key)
      }}
      onDragEnd={onDragEnd}
    >
      <div className="area-heading">
        <span>
          <button
            type="button"
            className="drag-handle-button"
            draggable={!draggedTaskId}
            onDragStart={(event) => {
              event.stopPropagation()
              onDragStart(area.key)
              event.dataTransfer.effectAllowed = 'move'
            }}
            aria-label={`Move ${area.label} tile`}
          >
            <GripVertical size={17} aria-hidden="true" />
          </button>
          <Icon size={18} />
          <strong>{area.label}</strong>
          <small>{area.short}</small>
        </span>
        <div className="area-controls">
          {area.key === 'ukg' && doneCount > 0 ? (
            <button
              type="button"
              className="mini-button"
              onClick={onClearCompleted}
              aria-label="Clear completed UKG to-dos"
            >
              <Eraser size={15} />
            </button>
          ) : null}
          <span className="count-pill">
            {tasks.length}
            <ChevronRight size={16} />
          </span>
        </div>
      </div>
      <div className="task-list">
        {area.key === 'ukg' && ukgProjects.length ? (
          ukgProjects.map((group) => (
            <div className="project-group" key={group.project}>
              <div className="project-heading">
                <button
                  type="button"
                  className="project-toggle"
                  onClick={() => toggleProject(group.project)}
                  onDragOver={(event) => {
                    if (!draggedTaskId) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(event) => {
                    if (!draggedTaskId) return
                    event.preventDefault()
                    event.stopPropagation()
                    onProjectTaskDrop(group.project)
                  }}
                  aria-expanded={!collapsedProjects.has(group.project)}
                >
                  <strong>{group.project}</strong>
                  <span>
                    <ChevronRight size={15} />
                    {group.tasks.filter((task) => task.status === 'done').length}/
                    {group.tasks.length}
                  </span>
                </button>
                <button
                  type="button"
                  className="project-clear-button"
                  onClick={() => onClearProject(group.project)}
                  aria-label={`Clear ${group.project}`}
                >
                  <Eraser size={14} />
                </button>
              </div>
              {!collapsedProjects.has(group.project) ? (
                <div className="project-items">
                  {group.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      hideNotes
                      isTaskDragging={draggedTaskId === task.id}
                      onPatchTask={onPatchTask}
                      onDeleteTask={onDeleteTask}
                      onTaskDragStart={onTaskDragStart}
                      onTaskDragEnd={onTaskDragEnd}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ))
        ) : tasks.length ? (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isTaskDragging={draggedTaskId === task.id}
              onPatchTask={onPatchTask}
              onDeleteTask={onDeleteTask}
              onTaskDragStart={onTaskDragStart}
              onTaskDragEnd={onTaskDragEnd}
            />
          ))
        ) : (
          <p className="empty-state">{area.empty}</p>
        )}
      </div>
    </section>
  )
}

function App() {
  const [tasks, setTasks] = useState<DashboardTask[]>([])
  const [draft, setDraft] = useState('')
  const [area, setArea] = useState<AreaKey>('today')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [includeReminder, setIncludeReminder] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncNotice, setSyncNotice] = useState('')
  const [areaOrder, setAreaOrder] = useState<AreaKey[]>(readAreaOrder)
  const [draggedArea, setDraggedArea] = useState<AreaKey | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null)
  const [hasSupabaseSession, setHasSupabaseSession] = useState(false)

  const mode: StoreMode =
    hasSupabaseConfig && hasSupabaseSession ? 'supabase' : 'local'
  const areaByKey = useMemo(
    () => new Map(areas.map((item) => [item.key, item])),
    [],
  )
  const orderedAreas = useMemo(
    () =>
      areaOrder
        .map((key) => areaByKey.get(key))
        .filter((item): item is AreaConfig => Boolean(item)),
    [areaByKey, areaOrder],
  )
  const mainAreas = useMemo(
    () => orderedAreas.filter((item) => !rightRailAreaKeys.has(item.key)),
    [orderedAreas],
  )
  const rightRailAreas = useMemo(
    () => orderedAreas.filter((item) => rightRailAreaKeys.has(item.key)),
    [orderedAreas],
  )
  const areaColumns = useMemo(
    () =>
      mainAreas.reduce<[AreaConfig[], AreaConfig[]]>(
        (columns, item, index) => {
          columns[index % 2].push(item)
          return columns
        },
        [[], []],
      ),
    [mainAreas],
  )

  async function refreshTasks() {
    try {
      setError('')
      const next = await listTasks(mode)
      setTasks(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load tasks.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshTasks()
    const unsubscribe =
      mode === 'supabase' ? subscribeToTasks(refreshTasks) : () => undefined
    const authSubscription = supabase?.auth.onAuthStateChange((_event, session) => {
      setHasSupabaseSession(isCrossDeviceUser(session?.user))
      refreshTasks()
    })

    return () => {
      unsubscribe()
      authSubscription?.data.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    if (!supabase) return undefined

    let cancelled = false

    async function activateSupabaseSession() {
      const { data: sessionData, error } = await supabase!.auth.getSession()
      if (cancelled) return

      if (error) {
        setSyncNotice('Saving on this device. Sign in again to sync across devices.')
        return
      }

      const user = sessionData.session?.user
      if (isCrossDeviceUser(user)) {
        setHasSupabaseSession(true)
        setSyncNotice('')
        return
      }

      if (user) {
        try {
          const importedCount = await copyCurrentSupabaseTasksToLocal()
          await supabase!.auth.signOut()
          if (cancelled) return
          setHasSupabaseSession(false)
          setSyncNotice(
            importedCount > 0
              ? 'Moved device-only items here. Sign in to sync them across iPad and laptop.'
              : 'Sign in to sync across iPad and laptop.',
          )
          const next = await listTasks('local')
          if (!cancelled) {
            setTasks(next)
            setLoading(false)
          }
        } catch (caught) {
          if (cancelled) return
          setSyncNotice('Sign in to sync across iPad and laptop.')
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not move device-only items into local storage.',
          )
        }
        return
      }

      setHasSupabaseSession(false)
      setSyncNotice('Sign in to sync across iPad and laptop.')
    }

    activateSupabaseSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!dueDate || !dueTime) setIncludeReminder(false)
  }, [dueDate, dueTime])

  useEffect(() => {
    if (mode !== 'supabase') return

    syncLocalTasksToSupabase()
      .then(refreshTasks)
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not sync local tasks to Supabase.',
        )
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const grouped = useMemo(
    () =>
      areas.reduce(
        (acc, current) => {
          acc[current.key] = tasks.filter((task) => {
            if (task.area !== current.key) return false
            return task.status === 'active' || task.status === 'done'
          })
          return acc
        },
        {} as Partial<Record<AreaKey, DashboardTask[]>>,
      ),
    [tasks],
  )
  const completedCount = tasks.filter((task) => task.status === 'done').length
  const moneyCount =
    (grouped.money?.length ?? 0) + (grouped.business?.length ?? 0)
  const today = new Date()
  const isWeekend = today.getDay() === 0 || today.getDay() === 6
  const workFocus = getWorkFocus(tasks)
  const focusTitle = isWeekend ? 'Today’s Focus' : 'Today’s Work Focus'
  const focusCopy = isWeekend
    ? 'Keep it light: pick the one thing that would make home, admin, or rest feel easier.'
    : workFocus
      ? `Start with ${workFocus[0]}; it has ${workFocus[1]} open ${workFocus[1] === 1 ? 'task' : 'tasks'}.`
      : 'No open work pile is shouting. Add one clear next action when it shows up.'

  function updateAreaOrder(nextOrder: AreaKey[]) {
    const previousOrder = areaOrder
    const normalized = normalizeAreaOrder(nextOrder)
    setUndoAction({
      label: 'Undo tile move',
      run: async () => {
        setAreaOrder(previousOrder)
        saveAreaOrder(previousOrder)
      },
    })
    setAreaOrder(normalized)
    saveAreaOrder(normalized)
  }

  function dropArea(targetArea: AreaKey) {
    if (!draggedArea || draggedArea === targetArea) {
      setDraggedArea(null)
      return
    }

    const nextOrder = areaOrder.filter((key) => key !== draggedArea)
    const targetIndex = nextOrder.indexOf(targetArea)
    nextOrder.splice(targetIndex, 0, draggedArea)
    updateAreaOrder(nextOrder)
    setDraggedArea(null)
  }

  function setTaskUndo(label: string, previousTasks: DashboardTask[]) {
    if (!previousTasks.length) return

    setUndoAction({
      label,
      run: async () => {
        await restoreTasks(mode, previousTasks)
        await refreshTasks()
      },
    })
  }

  async function undoLastAction() {
    if (!undoAction) return

    const action = undoAction
    setUndoAction(null)
    try {
      setError('')
      await action.run()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not undo that action.')
    }
  }

  async function patchTaskWithUndo(
    task: DashboardTask,
    patch: Partial<DashboardTask>,
    label: string,
  ) {
    try {
      setError('')
      setTaskUndo(label, [task])
      await updateTask(mode, task.id, patch)
      await refreshTasks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update task.')
    }
  }

  async function deleteTaskWithUndo(task: DashboardTask) {
    try {
      setError('')
      setTaskUndo('Undo delete task', [task])
      await deleteTask(mode, task.id)
      await refreshTasks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete task.')
    }
  }

  async function dropTask(targetArea: AreaKey, project?: string) {
    if (!draggedTaskId) return

    const task = tasks.find((item) => item.id === draggedTaskId)
    setDraggedTaskId(null)
    if (!task) return

    const nextNotes =
      targetArea === 'ukg' ? project ?? task.notes ?? 'General' : null
    if (task.area === targetArea && task.notes === nextNotes) return

    try {
      setError('')
      setTaskUndo('Undo task move', [task])
      await updateTask(mode, task.id, {
        area: targetArea,
        notes: nextNotes,
      })
      await refreshTasks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not move task.')
    }
  }

  async function clearUkgCompleted() {
    const previousTasks = tasks.filter(
      (task) => task.area === 'ukg' && task.status === 'done',
    )

    try {
      setError('')
      setTaskUndo('Undo clear completed', previousTasks)
      await clearCompletedTasks(mode, 'ukg')
      await refreshTasks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not clear completed UKG to-dos.')
    }
  }

  async function clearUkgProject(project: string) {
    if (!window.confirm(`Clear all visible tasks in ${project}?`)) return

    const previousTasks = tasks.filter(
      (task) =>
        task.area === 'ukg' &&
        (task.notes?.trim() || 'General') === project &&
        (task.status === 'active' || task.status === 'done'),
    )

    try {
      setError('')
      setTaskUndo('Undo clear project', previousTasks)
      await clearProjectTasks(mode, project)
      await refreshTasks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not clear ${project}.`)
    }
  }

  async function dailyReset() {
    const previousTasks = tasks.filter((task) => task.status === 'done')
    if (!previousTasks.length) return

    try {
      setError('')
      setTaskUndo('Undo daily reset', previousTasks)
      await clearDoneTasks(mode)
      await refreshTasks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset completed tasks.')
    }
  }

  async function handleAddTask(event: FormEvent) {
    event.preventDefault()
    if (!draft.trim()) return

    const selectedArea = area
    const dueAt = fromDateParts(dueDate, dueTime)
    const reminderMinutes = includeReminder && dueDate && dueTime ? 30 : null
    const inputs = buildTaskInputs(draft, selectedArea, dueAt, reminderMinutes)

    setSaving(true)
    try {
      setError('')
      for (const input of inputs) {
        await addTask(mode, input)
      }
      setDraft('')
      setDueDate('')
      setDueTime('')
      setIncludeReminder(false)
      await refreshTasks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save task.')
    } finally {
      setSaving(false)
    }
  }

  function renderAreaSection(item: AreaConfig) {
    return (
      <AreaSection
        key={item.key}
        area={item}
        tasks={grouped[item.key] ?? []}
        isDragging={draggedArea === item.key}
        isTaskDropTarget={Boolean(draggedTaskId) && !grouped[item.key]?.some((task) => task.id === draggedTaskId)}
        onClearCompleted={clearUkgCompleted}
        onClearProject={clearUkgProject}
        onDragStart={setDraggedArea}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropArea}
        onDragEnd={() => {
          setDraggedArea(null)
          setDraggedTaskId(null)
        }}
        draggedTaskId={draggedTaskId}
        onPatchTask={patchTaskWithUndo}
        onDeleteTask={deleteTaskWithUndo}
        onTaskDragStart={(taskId) => {
          setDraggedArea(null)
          setDraggedTaskId(taskId)
        }}
        onTaskDragEnd={() => setDraggedTaskId(null)}
        onTaskDrop={dropTask}
        onProjectTaskDrop={(project) => dropTask('ukg', project)}
      />
    )
  }

  return (
    <main className="dashboard-shell">
      <section className="top-band">
        <div className="title-block">
          <span>{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <h1>Jen's Dashboard</h1>
          <p>
            Capture what needs doing, keep work and home tasks visible, and
            make today easier to act on.
          </p>
        </div>

        <div className="focus-panel">
          <strong>{focusTitle}</strong>
          <p>{focusCopy}</p>
          <div>
            <span>{moneyCount} money/business items</span>
            <span>{completedCount} completed</span>
          </div>
        </div>
        <PomodoroWidget />
        <WeatherWidget />
      </section>

      <form className="capture-panel" onSubmit={handleAddTask}>
        <textarea
          value={draft}
          placeholder="Brain dump anything. For UKG: use Project headers, then numbered or bulleted to-dos."
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="capture-controls">
          <select
            value={area}
            onChange={(event) => setArea(event.target.value as AreaKey)}
            aria-label="Choose section"
          >
            {areas.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            aria-label="Due date"
          />
          <input
            type="time"
            value={dueTime}
            onChange={(event) => setDueTime(event.target.value)}
            aria-label="Optional alert time"
          />
          <label className="reminder-toggle">
            <input
              type="checkbox"
              checked={includeReminder}
              disabled={!dueDate || !dueTime}
              onChange={(event) => setIncludeReminder(event.target.checked)}
            />
            Alert
          </label>
          <button type="submit" disabled={saving}>
            {saving ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
            Add
          </button>
        </div>
      </form>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="loading-row">Loading your dashboard...</div> : null}
      <div className="board-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={undoLastAction}
          disabled={!undoAction}
        >
          <Undo2 size={16} />
          {undoAction?.label ?? 'Undo last action'}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={dailyReset}
          disabled={completedCount === 0}
        >
          <RotateCcw size={16} />
          Daily reset completed
        </button>
      </div>

      <div className="content-grid">
        <div className="main-lanes">
          {areaColumns.map((column, index) => (
            <div className="lane-column" key={`lane-column-${index}`}>
              {column.map((item) => renderAreaSection(item))}
            </div>
          ))}
        </div>
        <aside className="side-rail">
          <MonthCalendar />
          {rightRailAreas.map((item) => renderAreaSection(item))}
          <AuthPanel syncNotice={syncNotice} onAuthChange={refreshTasks} />
        </aside>
      </div>
    </main>
  )
}

export default App
