import { TOAST_DURATION_MS } from "@/lib/constants"

export type Toast = { id: string; title: string; description?: string; duration?: number; variant?: "success" | "error" }
type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
const listeners = new Set<Listener>()
const notify = () => listeners.forEach(l => l([...toasts]))

export function addToast(opts: Omit<Toast, 'id'>) {
  const id = Math.random().toString(36).slice(2)
  const duration = opts.duration ?? TOAST_DURATION_MS
  toasts = [...toasts, { id, ...opts, duration }]
  notify()
  setTimeout(() => removeToast(id), duration)
}

export function removeToast(id: string) {
  toasts = toasts.filter(t => t.id !== id)
  notify()
}

export function subscribe(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSnapshot(): Toast[] { return toasts }
