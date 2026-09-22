import { randomUUID } from "node:crypto"
import { runAgent } from "./runner.js"
import type { RunRequest, TaskRecord } from "./types.js"

export class TaskManager {
  readonly #tasks = new Map<string, TaskRecord>()
  readonly #controllers = new Map<string, AbortController>()

  start(request: RunRequest): TaskRecord {
    const task: TaskRecord = {
      id: randomUUID(), request, state: "queued", createdAt: new Date().toISOString(),
    }
    this.#tasks.set(task.id, task)
    const controller = new AbortController()
    this.#controllers.set(task.id, controller)

    queueMicrotask(async () => {
      if (controller.signal.aborted) return
      task.state = "running"
      task.startedAt = new Date().toISOString()
      try {
        task.result = await runAgent(request, controller.signal)
        task.state = controller.signal.aborted ? "cancelled" : "completed"
      } catch (error) {
        task.error = error instanceof Error ? error.message : String(error)
        task.state = controller.signal.aborted ? "cancelled" : "failed"
      } finally {
        task.completedAt = new Date().toISOString()
        this.#controllers.delete(task.id)
      }
    })
    return task
  }

  get(id: string): TaskRecord | undefined { return this.#tasks.get(id) }
  list(): TaskRecord[] { return [...this.#tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }

  cancel(id: string): boolean {
    const controller = this.#controllers.get(id)
    if (!controller) return false
    controller.abort()
    const task = this.#tasks.get(id)
    if (task) task.state = "cancelled"
    return true
  }
}
