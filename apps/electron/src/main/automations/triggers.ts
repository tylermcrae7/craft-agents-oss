/**
 * Trigger System
 *
 * Manages trigger registration and lifecycle for automations.
 * Each enabled automation gets its trigger registered; when the trigger
 * fires, the AutomationManager executes the automation.
 *
 * Implements:
 * - Schedule (cron) triggers via the croner library
 * - Hotkey triggers via Electron globalShortcut
 * - File change triggers via Node fs.watch
 * - Power event triggers via Electron powerMonitor
 * - App event triggers via Electron app events
 * - Clipboard triggers via polling
 * - Manual triggers (handled via IPC "Run Now" button, no registration needed)
 */

import { Cron } from 'croner'
import { globalShortcut, powerMonitor, app, clipboard } from 'electron'
import { watch, existsSync } from 'fs'
import type { FSWatcher } from 'fs'
import { mainLog } from '../logger'
import type {
  Automation,
  TriggerType,
  ScheduleTriggerConfig,
  HotkeyTriggerConfig,
  FileChangeTriggerConfig,
  PowerEventTriggerConfig,
  AppEventTriggerConfig,
  ClipboardTriggerConfig,
  FolderActionTriggerConfig,
} from '@craft-agent/shared/automations'

const triggerLog = {
  info: (...args: unknown[]) => mainLog.info('[triggers]', ...args),
  warn: (...args: unknown[]) => mainLog.warn('[triggers]', ...args),
  error: (...args: unknown[]) => mainLog.error('[triggers]', ...args),
}

/**
 * Callback invoked when a trigger fires
 */
export type TriggerCallback = (
  workspaceId: string,
  automationId: string,
  triggeredBy: TriggerType,
  triggerContext?: Record<string, unknown>,
) => void

/**
 * Represents a registered trigger that can be stopped
 */
interface RegisteredTrigger {
  automationId: string
  type: TriggerType
  stop: () => void
}

/**
 * Manages all active triggers for automations.
 */
export class TriggerRegistry {
  /** Active triggers keyed by automation ID */
  private triggers: Map<string, RegisteredTrigger> = new Map()

  /** Callback to invoke when a trigger fires */
  private onTrigger: TriggerCallback

  constructor(onTrigger: TriggerCallback) {
    this.onTrigger = onTrigger
  }

  /**
   * Register a trigger for an enabled automation.
   * If a trigger is already registered for this automation, it's replaced.
   */
  register(automation: Automation): void {
    // Remove existing trigger if any
    this.unregister(automation.id)

    const config = automation.triggerConfig

    switch (config.type) {
      case 'schedule':
        this.registerScheduleTrigger(automation, config)
        break
      case 'hotkey':
        this.registerHotkeyTrigger(automation, config)
        break
      case 'file-change':
        this.registerFileChangeTrigger(automation, config)
        break
      case 'power-event':
        this.registerPowerEventTrigger(automation, config)
        break
      case 'app-event':
        this.registerAppEventTrigger(automation, config)
        break
      case 'clipboard':
        this.registerClipboardTrigger(automation, config)
        break
      case 'folder-action':
        this.registerFolderActionTrigger(automation, config)
        break
      case 'manual':
        // Manual triggers don't need registration - handled by IPC "Run Now"
        break
      case 'webhook':
      case 'deep-link':
        triggerLog.warn(`Trigger type "${config.type}" not yet implemented for "${automation.name}"`)
        break
    }
  }

  /**
   * Unregister a trigger for an automation.
   */
  unregister(automationId: string): void {
    const existing = this.triggers.get(automationId)
    if (existing) {
      existing.stop()
      this.triggers.delete(automationId)
      triggerLog.info(`Unregistered ${existing.type} trigger for automation ${automationId}`)
    }
  }

  /**
   * Unregister all triggers (cleanup on shutdown).
   */
  unregisterAll(): void {
    for (const [id, trigger] of this.triggers) {
      trigger.stop()
    }
    this.triggers.clear()
    triggerLog.info('All triggers unregistered')
  }

  /**
   * Get count of active triggers.
   */
  getActiveTriggerCount(): number {
    return this.triggers.size
  }

  // ============================================================
  // Schedule Trigger (cron)
  // ============================================================

  private registerScheduleTrigger(automation: Automation, config: ScheduleTriggerConfig): void {
    if (!config.cron) {
      triggerLog.warn(`Schedule trigger for "${automation.name}" has no cron expression`)
      return
    }

    try {
      const job = new Cron(config.cron, {
        timezone: config.timezone,
        name: `automation-${automation.id}`,
      }, () => {
        triggerLog.info(`Schedule trigger fired for "${automation.name}" (cron: ${config.cron})`)
        this.onTrigger(automation.workspaceId, automation.id, 'schedule', {
          cron: config.cron,
          firedAt: new Date().toISOString(),
          nextRun: job.nextRun()?.toISOString() ?? null,
        })
      })

      const nextRun = job.nextRun()
      triggerLog.info(
        `Registered schedule trigger for "${automation.name}" (cron: ${config.cron}, next: ${nextRun?.toISOString() ?? 'unknown'})`
      )

      this.triggers.set(automation.id, {
        automationId: automation.id,
        type: 'schedule',
        stop: () => job.stop(),
      })
    } catch (error) {
      triggerLog.error(`Failed to register schedule trigger for "${automation.name}": ${error}`)
    }
  }

  // ============================================================
  // Hotkey Trigger (Electron globalShortcut)
  // ============================================================

  private registerHotkeyTrigger(automation: Automation, config: HotkeyTriggerConfig): void {
    if (!config.accelerator) {
      triggerLog.warn(`Hotkey trigger for "${automation.name}" has no accelerator`)
      return
    }

    try {
      const success = globalShortcut.register(config.accelerator, () => {
        triggerLog.info(`Hotkey trigger fired for "${automation.name}" (${config.accelerator})`)
        this.onTrigger(automation.workspaceId, automation.id, 'hotkey', {
          accelerator: config.accelerator,
          firedAt: new Date().toISOString(),
        })
      })

      if (success) {
        triggerLog.info(`Registered hotkey trigger for "${automation.name}" (${config.accelerator})`)
        this.triggers.set(automation.id, {
          automationId: automation.id,
          type: 'hotkey',
          stop: () => {
            try {
              globalShortcut.unregister(config.accelerator)
            } catch {
              // May already be unregistered
            }
          },
        })
      } else {
        triggerLog.warn(
          `Failed to register hotkey "${config.accelerator}" for "${automation.name}" - shortcut may be in use`
        )
      }
    } catch (error) {
      triggerLog.error(`Failed to register hotkey trigger for "${automation.name}": ${error}`)
    }
  }

  // ============================================================
  // File Change Trigger (Node fs.watch)
  // ============================================================

  private registerFileChangeTrigger(automation: Automation, config: FileChangeTriggerConfig): void {
    if (!config.paths || config.paths.length === 0) {
      triggerLog.warn(`File change trigger for "${automation.name}" has no paths`)
      return
    }

    const watchers: FSWatcher[] = []
    const debounceMs = config.debounceMs ?? 5000
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let pendingChanges: Array<{ path: string; event: string }> = []

    const flushChanges = () => {
      if (pendingChanges.length === 0) return
      const changes = [...pendingChanges]
      pendingChanges = []

      triggerLog.info(
        `File change trigger fired for "${automation.name}" (${changes.length} change(s))`
      )
      this.onTrigger(automation.workspaceId, automation.id, 'file-change', {
        changes,
        firedAt: new Date().toISOString(),
      })
    }

    for (const watchPath of config.paths) {
      if (!existsSync(watchPath)) {
        triggerLog.warn(`Watch path does not exist: ${watchPath}`)
        continue
      }

      try {
        const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
          // Filter by patterns if specified
          if (config.patterns && config.patterns.length > 0 && filename) {
            const matchesPattern = config.patterns.some((pattern) => {
              // Simple glob matching: *.ext or **/*.ext
              if (pattern.startsWith('*.')) {
                return filename.endsWith(pattern.slice(1))
              }
              if (pattern.startsWith('**/')) {
                return filename.includes(pattern.slice(3))
              }
              return filename === pattern
            })
            if (!matchesPattern) return
          }

          // Filter by event types if specified
          if (config.events && config.events.length > 0) {
            const mappedEvent = eventType === 'rename' ? 'add' : 'change'
            if (!config.events.includes(mappedEvent as any)) return
          }

          pendingChanges.push({ path: `${watchPath}/${filename}`, event: eventType })

          // Debounce
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(flushChanges, debounceMs)
        })

        watchers.push(watcher)
      } catch (error) {
        triggerLog.error(`Failed to watch path "${watchPath}": ${error}`)
      }
    }

    if (watchers.length > 0) {
      triggerLog.info(
        `Registered file change trigger for "${automation.name}" (${watchers.length} watcher(s))`
      )

      this.triggers.set(automation.id, {
        automationId: automation.id,
        type: 'file-change',
        stop: () => {
          if (debounceTimer) clearTimeout(debounceTimer)
          for (const watcher of watchers) {
            watcher.close()
          }
        },
      })
    }
  }

  // ============================================================
  // Power Event Trigger (Electron powerMonitor)
  // ============================================================

  private registerPowerEventTrigger(automation: Automation, config: PowerEventTriggerConfig): void {
    if (!config.events || config.events.length === 0) {
      triggerLog.warn(`Power event trigger for "${automation.name}" has no events`)
      return
    }

    // Map our event names to Electron powerMonitor event names
    const eventMap: Record<string, string> = {
      'on-ac': 'on-ac',
      'on-battery': 'on-battery',
      'suspend': 'suspend',
      'resume': 'resume',
      'lock-screen': 'lock-screen',
      'unlock-screen': 'unlock-screen',
    }

    const listeners: Array<{ event: string; handler: () => void }> = []

    for (const eventName of config.events) {
      const electronEvent = eventMap[eventName]
      if (!electronEvent) {
        triggerLog.warn(`Unknown power event: ${eventName}`)
        continue
      }

      const handler = () => {
        triggerLog.info(`Power event "${eventName}" fired for "${automation.name}"`)
        this.onTrigger(automation.workspaceId, automation.id, 'power-event', {
          event: eventName,
          firedAt: new Date().toISOString(),
        })
      }

      powerMonitor.on(electronEvent as any, handler)
      listeners.push({ event: electronEvent, handler })
    }

    if (listeners.length > 0) {
      triggerLog.info(
        `Registered power event trigger for "${automation.name}" (${config.events.join(', ')})`
      )

      this.triggers.set(automation.id, {
        automationId: automation.id,
        type: 'power-event',
        stop: () => {
          for (const { event, handler } of listeners) {
            powerMonitor.removeListener(event, handler)
          }
        },
      })
    }
  }

  // ============================================================
  // App Event Trigger (Electron app events)
  // ============================================================

  private registerAppEventTrigger(automation: Automation, config: AppEventTriggerConfig): void {
    if (!config.events || config.events.length === 0) {
      triggerLog.warn(`App event trigger for "${automation.name}" has no events`)
      return
    }

    const listeners: Array<{ event: string; handler: (...args: any[]) => void }> = []

    for (const eventName of config.events) {
      let electronEvent: string
      switch (eventName) {
        case 'app-ready':
          // App is already ready if we're registering triggers, fire immediately
          triggerLog.info(`App event "app-ready" fired immediately for "${automation.name}"`)
          this.onTrigger(automation.workspaceId, automation.id, 'app-event', {
            event: eventName,
            firedAt: new Date().toISOString(),
          })
          continue
        case 'window-focus':
          electronEvent = 'browser-window-focus'
          break
        case 'window-blur':
          electronEvent = 'browser-window-blur'
          break
        default:
          triggerLog.warn(`Unknown app event: ${eventName}`)
          continue
      }

      const handler = () => {
        triggerLog.info(`App event "${eventName}" fired for "${automation.name}"`)
        this.onTrigger(automation.workspaceId, automation.id, 'app-event', {
          event: eventName,
          firedAt: new Date().toISOString(),
        })
      }

      app.on(electronEvent as any, handler)
      listeners.push({ event: electronEvent, handler })
    }

    if (listeners.length > 0 || config.events.includes('app-ready')) {
      triggerLog.info(
        `Registered app event trigger for "${automation.name}" (${config.events.join(', ')})`
      )

      this.triggers.set(automation.id, {
        automationId: automation.id,
        type: 'app-event',
        stop: () => {
          for (const { event, handler } of listeners) {
            app.removeListener(event, handler)
          }
        },
      })
    }
  }

  // ============================================================
  // Clipboard Trigger (polling)
  // ============================================================

  private registerClipboardTrigger(automation: Automation, config: ClipboardTriggerConfig): void {
    const pollInterval = config.pollIntervalMs ?? 2000
    let lastContent = clipboard.readText()
    let regex: RegExp | null = null

    if (config.pattern) {
      try {
        regex = new RegExp(config.pattern)
      } catch {
        triggerLog.warn(`Invalid clipboard pattern regex for "${automation.name}": ${config.pattern}`)
      }
    }

    const intervalId = setInterval(() => {
      const currentContent = clipboard.readText()
      if (currentContent === lastContent) return
      lastContent = currentContent

      // Check pattern match if specified
      if (regex && !regex.test(currentContent)) return

      triggerLog.info(`Clipboard trigger fired for "${automation.name}"`)
      this.onTrigger(automation.workspaceId, automation.id, 'clipboard', {
        content: currentContent.slice(0, 500), // Limit context size
        firedAt: new Date().toISOString(),
      })
    }, pollInterval)

    triggerLog.info(
      `Registered clipboard trigger for "${automation.name}" (poll: ${pollInterval}ms${config.pattern ? `, pattern: ${config.pattern}` : ''})`
    )

    this.triggers.set(automation.id, {
      automationId: automation.id,
      type: 'clipboard',
      stop: () => clearInterval(intervalId),
    })
  }

  // ============================================================
  // Folder Action Trigger (Hazel-style: new files in folder)
  // ============================================================

  private registerFolderActionTrigger(automation: Automation, config: FolderActionTriggerConfig): void {
    if (!config.folderPath) {
      triggerLog.warn(`Folder action trigger for "${automation.name}" has no folder path`)
      return
    }

    if (!existsSync(config.folderPath)) {
      triggerLog.warn(`Folder action path does not exist: ${config.folderPath}`)
      return
    }

    const debounceMs = 3000
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let pendingFiles: string[] = []

    const flushFiles = () => {
      if (pendingFiles.length === 0) return
      const files = [...pendingFiles]
      pendingFiles = []

      triggerLog.info(
        `Folder action trigger fired for "${automation.name}" (${files.length} new file(s))`
      )
      this.onTrigger(automation.workspaceId, automation.id, 'folder-action', {
        files,
        folderPath: config.folderPath,
        firedAt: new Date().toISOString(),
      })
    }

    try {
      const watcher = watch(config.folderPath, (eventType, filename) => {
        if (eventType !== 'rename' || !filename) return // Only new files

        // Filter by extensions
        if (config.extensions && config.extensions.length > 0) {
          const matches = config.extensions.some((ext) => filename.endsWith(ext))
          if (!matches) return
        }

        // Filter by name pattern (simple glob)
        if (config.namePattern) {
          const pattern = config.namePattern
          if (pattern.startsWith('*.')) {
            if (!filename.endsWith(pattern.slice(1))) return
          } else if (!filename.includes(pattern)) {
            return
          }
        }

        pendingFiles.push(filename)

        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(flushFiles, debounceMs)
      })

      triggerLog.info(
        `Registered folder action trigger for "${automation.name}" (${config.folderPath})`
      )

      this.triggers.set(automation.id, {
        automationId: automation.id,
        type: 'folder-action',
        stop: () => {
          if (debounceTimer) clearTimeout(debounceTimer)
          watcher.close()
        },
      })
    } catch (error) {
      triggerLog.error(`Failed to register folder action trigger for "${automation.name}": ${error}`)
    }
  }
}
