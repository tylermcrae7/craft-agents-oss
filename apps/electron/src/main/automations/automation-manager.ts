/**
 * AutomationManager
 *
 * Central orchestrator for the automations system in the main process.
 * Manages automation lifecycle: creating sessions, sending prompts,
 * tracking completion, and updating run records.
 *
 * Design:
 * - Subscribes to SessionManager events to track automation session completion
 * - Creates hidden sessions for each automation run
 * - Enforces concurrency limits and timeouts
 * - Broadcasts automation events to renderer via WindowManager
 * - Uses TriggerRegistry to manage schedule/event-based triggers
 */

import { SessionManager } from '../sessions'
import { WindowManager } from '../window-manager'
import { IPC_CHANNELS } from '../../shared/types'
import { mainLog } from '../logger'
import { TriggerRegistry } from './triggers'
import type {
  Automation,
  AutomationRun,
  TriggerType,
} from '@craft-agent/shared/automations'
import {
  loadAutomations,
  getAutomation,
  createRun,
  updateRun,
  updateAutomationAfterRun,
} from '@craft-agent/shared/automations'
import { getWorkspaces, getWorkspaceByNameOrId } from '@craft-agent/shared/config'

const automationLog = {
  info: (...args: unknown[]) => mainLog.info('[automations]', ...args),
  warn: (...args: unknown[]) => mainLog.warn('[automations]', ...args),
  error: (...args: unknown[]) => mainLog.error('[automations]', ...args),
}

/**
 * Tracks an actively running automation
 */
interface ActiveRun {
  runId: string
  automationId: string
  workspaceId: string
  workspaceRoot: string
  sessionId: string
  startTime: number
  timeoutTimer: ReturnType<typeof setTimeout> | null
}

export class AutomationManager {
  private sessionManager: SessionManager
  private windowManager: WindowManager
  private triggerRegistry: TriggerRegistry

  /** Currently executing runs: runId -> ActiveRun */
  private activeRuns: Map<string, ActiveRun> = new Map()
  /** Maps session IDs to run IDs for event routing */
  private sessionToRun: Map<string, string> = new Map()

  /** Max concurrent runs (can be configured per-workspace in future) */
  private maxConcurrentRuns = 2

  /** Bound event listener reference for cleanup */
  private boundEventListener: (event: any, workspaceId?: string) => void

  constructor(sessionManager: SessionManager, windowManager: WindowManager) {
    this.sessionManager = sessionManager
    this.windowManager = windowManager
    this.boundEventListener = this.handleSessionEvent.bind(this)

    // Create trigger registry with callback that routes to executeAutomation
    this.triggerRegistry = new TriggerRegistry(
      (workspaceId, automationId, triggeredBy, triggerContext) => {
        this.executeAutomation(workspaceId, automationId, triggeredBy, triggerContext).catch(
          (err) => {
            automationLog.error(
              `Trigger-initiated execution failed for ${automationId}: ${err}`
            )
          }
        )
      }
    )
  }

  /**
   * Initialize the automation manager.
   * Subscribes to session events and loads triggers for all enabled automations.
   */
  initialize(): void {
    this.sessionManager.addMainProcessEventListener(this.boundEventListener)
    this.loadAllTriggers()
    automationLog.info('AutomationManager initialized')
  }

  /**
   * Load automations from all workspaces and register triggers for enabled ones.
   */
  private loadAllTriggers(): void {
    const workspaces = getWorkspaces()
    let totalRegistered = 0

    for (const workspace of workspaces) {
      try {
        const automations = loadAutomations(workspace.rootPath)
        for (const automation of automations) {
          if (automation.enabled) {
            this.triggerRegistry.register(automation)
            totalRegistered++
          }
        }
      } catch (err) {
        automationLog.error(
          `Failed to load automations for workspace "${workspace.name}": ${err}`
        )
      }
    }

    automationLog.info(
      `Loaded triggers for ${totalRegistered} enabled automation(s) across ${workspaces.length} workspace(s)`
    )
  }

  /**
   * Refresh triggers for a specific automation (called after enable/disable/update).
   */
  refreshTrigger(workspaceId: string, automationId: string): void {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return

    const automation = getAutomation(workspace.rootPath, automationId)
    if (!automation) {
      this.triggerRegistry.unregister(automationId)
      return
    }

    if (automation.enabled) {
      this.triggerRegistry.register(automation)
    } else {
      this.triggerRegistry.unregister(automationId)
    }
  }

  /**
   * Execute an automation by creating a session and sending the prompt.
   * Returns the run record immediately; completion is tracked asynchronously.
   */
  async executeAutomation(
    workspaceId: string,
    automationId: string,
    triggeredBy: TriggerType,
    triggerContext?: Record<string, unknown>,
  ): Promise<AutomationRun> {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const automation = getAutomation(workspace.rootPath, automationId)
    if (!automation) throw new Error(`Automation not found: ${automationId}`)

    // Check concurrency limit
    if (this.activeRuns.size >= this.maxConcurrentRuns) {
      throw new Error(
        `Concurrency limit reached (${this.maxConcurrentRuns} max). Wait for a running automation to complete.`
      )
    }

    automationLog.info(
      `Executing automation "${automation.name}" (${automationId}) triggered by ${triggeredBy}`
    )

    // Create run record
    const run = createRun(workspace.rootPath, automationId, triggeredBy, triggerContext)

    // Broadcast run_started
    this.broadcastAutomationEvent({ type: 'run_started', run })

    try {
      // Create a hidden session for this automation run
      const session = await this.sessionManager.createSession(workspaceId, {
        permissionMode: automation.actionConfig.permissionMode || 'safe',
        model: automation.actionConfig.model,
        workingDirectory: automation.actionConfig.workingDirectory || 'user_default',
        hidden: true,
      })

      // Update run with session ID and status
      const updatedRun = updateRun(workspace.rootPath, run.id, {
        status: 'running',
        sessionId: session.id,
      })

      if (!updatedRun) {
        throw new Error('Failed to update run record')
      }

      // Track the active run
      const timeoutMs = (automation.actionConfig.timeoutSeconds || 300) * 1000
      const activeRun: ActiveRun = {
        runId: run.id,
        automationId,
        workspaceId,
        workspaceRoot: workspace.rootPath,
        sessionId: session.id,
        startTime: Date.now(),
        timeoutTimer: setTimeout(() => this.handleTimeout(run.id), timeoutMs),
      }

      this.activeRuns.set(run.id, activeRun)
      this.sessionToRun.set(session.id, run.id)

      // Configure session sources if specified
      if (automation.actionConfig.sourceSlugs?.length) {
        await this.sessionManager.setSessionSources(
          session.id,
          automation.actionConfig.sourceSlugs,
        )
      }

      // Build the prompt with trigger context if available
      let prompt = automation.prompt
      if (triggerContext && Object.keys(triggerContext).length > 0) {
        prompt += `\n\n---\nTrigger context:\n${JSON.stringify(triggerContext, null, 2)}`
      }

      // Send the automation prompt to the session
      await this.sessionManager.sendMessage(session.id, prompt)

      automationLog.info(
        `Run ${run.id} started for "${automation.name}" (session: ${session.id})`
      )

      return updatedRun
    } catch (error) {
      // If session creation or message sending fails, mark run as failed
      const errorMessage = error instanceof Error ? error.message : String(error)
      automationLog.error(`Run ${run.id} failed to start: ${errorMessage}`)

      const failedRun = updateRun(workspace.rootPath, run.id, {
        status: 'failure',
        completedAt: new Date().toISOString(),
        error: errorMessage,
      })

      if (failedRun) {
        updateAutomationAfterRun(workspace.rootPath, automationId, failedRun)
        this.broadcastAutomationEvent({ type: 'run_failed', run: failedRun })
        this.broadcastAutomationsChanged(workspace.rootPath)
      }

      throw error
    }
  }

  /**
   * Cancel a running automation.
   */
  async cancelRun(workspaceId: string, runId: string): Promise<boolean> {
    const active = this.activeRuns.get(runId)
    if (!active) {
      automationLog.warn(`Cannot cancel run ${runId}: not actively running`)
      return false
    }

    automationLog.info(`Cancelling run ${runId}`)

    // Cancel the session processing
    await this.sessionManager.cancelProcessing(active.sessionId)

    // Complete the run as cancelled
    this.completeRun(runId, 'cancelled')
    return true
  }

  /**
   * Get number of currently active runs.
   */
  getActiveRunCount(): number {
    return this.activeRuns.size
  }

  /**
   * Check if a specific automation has an active run.
   */
  isAutomationRunning(automationId: string): boolean {
    for (const active of this.activeRuns.values()) {
      if (active.automationId === automationId) return true
    }
    return false
  }

  /**
   * Handle session events from SessionManager.
   * Routes completion/error events to the appropriate automation run.
   */
  private handleSessionEvent(event: any, _workspaceId?: string): void {
    // Only care about complete and error events
    if (event.type !== 'complete' && event.type !== 'error') return

    const sessionId = event.sessionId
    if (!sessionId) return

    const runId = this.sessionToRun.get(sessionId)
    if (!runId) return // Not an automation session

    const active = this.activeRuns.get(runId)
    if (!active) return

    if (event.type === 'complete') {
      automationLog.info(`Session ${sessionId} completed for run ${runId}`)
      this.completeRun(runId, 'success')
    } else if (event.type === 'error') {
      automationLog.error(`Session ${sessionId} errored for run ${runId}: ${event.error}`)
      this.completeRun(runId, 'failure', event.error)
    }
  }

  /**
   * Handle automation run timeout.
   */
  private handleTimeout(runId: string): void {
    const active = this.activeRuns.get(runId)
    if (!active) return

    automationLog.warn(
      `Run ${runId} timed out after ${Date.now() - active.startTime}ms`
    )

    // Cancel the session
    this.sessionManager.cancelProcessing(active.sessionId).catch((err) => {
      automationLog.error(`Failed to cancel timed-out session: ${err}`)
    })

    this.completeRun(runId, 'failure', 'Automation timed out')
  }

  /**
   * Complete a run: update storage, broadcast events, clean up tracking.
   */
  private completeRun(
    runId: string,
    status: 'success' | 'failure' | 'cancelled',
    error?: string,
  ): void {
    const active = this.activeRuns.get(runId)
    if (!active) return

    const completedAt = new Date().toISOString()

    // Update run record
    const updatedRun = updateRun(active.workspaceRoot, runId, {
      status,
      completedAt,
      error: error || null,
    })

    if (updatedRun) {
      // Update automation metadata (lastRunAt, runCount, lastStatus)
      updateAutomationAfterRun(active.workspaceRoot, active.automationId, updatedRun)

      // Broadcast appropriate event
      const eventType =
        status === 'success'
          ? 'run_completed'
          : status === 'cancelled'
            ? 'run_cancelled'
            : 'run_failed'
      this.broadcastAutomationEvent({ type: eventType, run: updatedRun })

      // Broadcast updated automations list
      this.broadcastAutomationsChanged(active.workspaceRoot)

      automationLog.info(
        `Run ${runId} completed: ${status}${error ? ` (${error})` : ''}`
      )
    }

    // Cleanup
    if (active.timeoutTimer) {
      clearTimeout(active.timeoutTimer)
    }
    this.sessionToRun.delete(active.sessionId)
    this.activeRuns.delete(runId)
  }

  /**
   * Broadcast an automation event to all windows.
   */
  private broadcastAutomationEvent(event: { type: string; run?: AutomationRun; automationId?: string }): void {
    this.windowManager.broadcastToAll(IPC_CHANNELS.AUTOMATION_EVENT, event)
  }

  /**
   * Broadcast updated automations list to all windows.
   */
  private broadcastAutomationsChanged(workspaceRoot: string): void {
    const automations = loadAutomations(workspaceRoot)
    this.windowManager.broadcastToAll(IPC_CHANNELS.AUTOMATIONS_CHANGED, automations)
  }

  /**
   * Clean up all active runs and triggers (called on app quit).
   */
  cleanup(): void {
    automationLog.info(`Cleaning up ${this.activeRuns.size} active run(s)`)

    // Stop all triggers
    this.triggerRegistry.unregisterAll()

    for (const [runId, active] of this.activeRuns) {
      if (active.timeoutTimer) {
        clearTimeout(active.timeoutTimer)
      }

      // Mark as cancelled in storage
      const updatedRun = updateRun(active.workspaceRoot, runId, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
        error: 'App shutting down',
      })

      if (updatedRun) {
        updateAutomationAfterRun(active.workspaceRoot, active.automationId, updatedRun)
      }
    }

    this.activeRuns.clear()
    this.sessionToRun.clear()
    this.sessionManager.removeMainProcessEventListener(this.boundEventListener)
  }
}
