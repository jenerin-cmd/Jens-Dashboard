import type { DashboardTask, NewTaskInput, StoreMode } from './types'
import { supabase } from './supabase'

const LOCAL_KEY = 'jens-dashboard-tasks-v1'
const SHARED_DASHBOARD_ID = 'jen-dashboard'

function now() {
  return new Date().toISOString()
}

function createLocalTask(input: NewTaskInput): DashboardTask {
  const timestamp = now()

  return {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    notes: input.notes ?? null,
    area: input.area ?? 'today',
    priority: input.priority ?? 'normal',
    status: 'active',
    due_at: input.due_at ?? null,
    reminder_minutes: input.reminder_minutes ?? null,
    cost_estimate: input.cost_estimate ?? null,
    saved_amount: input.saved_amount ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

function readLocalTasks() {
  const raw = localStorage.getItem(LOCAL_KEY)
  if (!raw) return []

  try {
    return JSON.parse(raw) as DashboardTask[]
  } catch {
    return []
  }
}

function writeLocalTasks(tasks: DashboardTask[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(tasks))
}

export async function listTasks(mode: StoreMode) {
  if (mode === 'supabase' && supabase) {
    const client = supabase
    const { data, error } = await client
      .from('dashboard_tasks')
      .select('*')
      .eq('dashboard_id', SHARED_DASHBOARD_ID)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data ?? []
  }

  return readLocalTasks()
}

export async function addTask(mode: StoreMode, input: NewTaskInput) {
  if (mode === 'supabase' && supabase) {
    const client = supabase
    const { data, error } = await client
      .from('dashboard_tasks')
      .insert({
        dashboard_id: SHARED_DASHBOARD_ID,
        title: input.title.trim(),
        notes: input.notes ?? null,
        area: input.area ?? 'today',
        priority: input.priority ?? 'normal',
        status: 'active',
        due_at: input.due_at ?? null,
        reminder_minutes: input.reminder_minutes ?? null,
        cost_estimate: input.cost_estimate ?? null,
        saved_amount: input.saved_amount ?? null,
        user_id: null,
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  const task = createLocalTask(input)
  writeLocalTasks([task, ...readLocalTasks()])
  return task
}

export async function updateTask(
  mode: StoreMode,
  id: string,
  patch: Partial<DashboardTask>,
) {
  if (mode === 'supabase' && supabase) {
    const client = supabase
    const { data, error } = await client
      .from('dashboard_tasks')
      .update({ ...patch, updated_at: now() })
      .eq('id', id)
      .eq('dashboard_id', SHARED_DASHBOARD_ID)
      .select()
      .single()

    if (error) throw error
    return data
  }

  const tasks = readLocalTasks().map((task) =>
    task.id === id ? { ...task, ...patch, updated_at: now() } : task,
  )
  writeLocalTasks(tasks)
  return tasks.find((task) => task.id === id) ?? null
}

export async function deleteTask(mode: StoreMode, id: string) {
  if (mode === 'supabase' && supabase) {
    const client = supabase
    const { error } = await client
      .from('dashboard_tasks')
      .delete()
      .eq('id', id)
      .eq('dashboard_id', SHARED_DASHBOARD_ID)
    if (error) throw error
    return
  }

  writeLocalTasks(readLocalTasks().filter((task) => task.id !== id))
}

export async function restoreTasks(mode: StoreMode, tasks: DashboardTask[]) {
  if (!tasks.length) return

  if (mode === 'supabase' && supabase) {
    const client = supabase
    const { error } = await client.from('dashboard_tasks').upsert(
      tasks.map((task) => ({
        ...task,
        dashboard_id: SHARED_DASHBOARD_ID,
        user_id: null,
        updated_at: now(),
      })),
      { onConflict: 'id' },
    )

    if (error) throw error
    return
  }

  const current = readLocalTasks()
  const restoredIds = new Set(tasks.map((task) => task.id))
  writeLocalTasks([
    ...tasks.map((task) => ({ ...task, updated_at: now() })),
    ...current.filter((task) => !restoredIds.has(task.id)),
  ])
}

export async function clearCompletedTasks(mode: StoreMode, area: DashboardTask['area']) {
  if (mode === 'supabase' && supabase) {
    const client = supabase
    const { error } = await client
      .from('dashboard_tasks')
      .update({ status: 'cleared', updated_at: now() })
      .eq('dashboard_id', SHARED_DASHBOARD_ID)
      .eq('area', area)
      .eq('status', 'done')

    if (error) throw error
    return
  }

  const tasks = readLocalTasks().map((task) =>
    task.area === area && task.status === 'done'
      ? { ...task, status: 'cleared' as const, updated_at: now() }
      : task,
  )
  writeLocalTasks(tasks)
}

export async function clearDoneTasks(mode: StoreMode) {
  if (mode === 'supabase' && supabase) {
    const client = supabase
    const { error } = await client
      .from('dashboard_tasks')
      .update({ status: 'cleared', updated_at: now() })
      .eq('dashboard_id', SHARED_DASHBOARD_ID)
      .eq('status', 'done')

    if (error) throw error
    return
  }

  const tasks = readLocalTasks().map((task) =>
    task.status === 'done'
      ? { ...task, status: 'cleared' as const, updated_at: now() }
      : task,
  )
  writeLocalTasks(tasks)
}

export async function clearProjectTasks(mode: StoreMode, project: string) {
  if (mode === 'supabase' && supabase) {
    const client = supabase
    const { error } = await client
      .from('dashboard_tasks')
      .update({ status: 'cleared', updated_at: now() })
      .eq('dashboard_id', SHARED_DASHBOARD_ID)
      .eq('area', 'ukg')
      .eq('notes', project)
      .in('status', ['active', 'done'])

    if (error) throw error
    return
  }

  const tasks = readLocalTasks().map((task) =>
    task.area === 'ukg' &&
    (task.notes?.trim() || 'General') === project &&
    (task.status === 'active' || task.status === 'done')
      ? { ...task, status: 'cleared' as const, updated_at: now() }
      : task,
  )
  writeLocalTasks(tasks)
}

export function subscribeToTasks(onChange: () => void) {
  if (!supabase) return () => undefined

  const client = supabase
  const channel = client
    .channel('dashboard-tasks-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'dashboard_tasks',
        filter: `dashboard_id=eq.${SHARED_DASHBOARD_ID}`,
      },
      onChange,
    )
    .subscribe()

  return () => {
    client.removeChannel(channel)
  }
}
