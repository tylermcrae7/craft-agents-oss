/**
 * Automations Types
 *
 * Core type definitions for the automations system.
 * Automations are scheduled or event-triggered agent tasks.
 */

// ============================================================
// Trigger Types
// ============================================================

/**
 * Supported trigger types for automations
 */
export type TriggerType =
  | 'schedule'        // cron/rrule time-based
  | 'file-change'     // FSEvents on watched paths
  | 'hotkey'          // global keyboard shortcut
  | 'webhook'         // HTTP POST to localhost endpoint
  | 'deep-link'       // craftagents://automation/run/{id}
  | 'app-event'       // app launch/quit/activate
  | 'power-event'     // sleep/wake/lid-open/idle
  | 'clipboard'       // clipboard content change
  | 'folder-action'   // Hazel-style: new file matching rules in folder
  | 'manual'          // user clicks "Run Now"

/**
 * Schedule trigger config (cron or rrule)
 */
export interface ScheduleTriggerConfig {
  type: 'schedule'
  /** Cron expression (e.g., "0 9 * * *" for 9am daily) */
  cron?: string
  /** RFC 5545 rrule string (alternative to cron) */
  rrule?: string
  /** Timezone for schedule evaluation (defaults to system timezone) */
  timezone?: string
}

/**
 * File change trigger config
 */
export interface FileChangeTriggerConfig {
  type: 'file-change'
  /** Absolute path(s) to watch */
  paths: string[]
  /** Glob patterns to match (e.g., "*.md", "**\/*.ts") */
  patterns?: string[]
  /** Event types to watch */
  events: ('add' | 'change' | 'unlink')[]
  /** Debounce interval in ms (default 5000) */
  debounceMs?: number
}

/**
 * Hotkey trigger config
 */
export interface HotkeyTriggerConfig {
  type: 'hotkey'
  /** Electron accelerator string (e.g., "CommandOrControl+Shift+A") */
  accelerator: string
}

/**
 * Webhook trigger config
 */
export interface WebhookTriggerConfig {
  type: 'webhook'
  /** Route path (auto-generated: /automations/{id}/trigger) */
  path?: string
  /** Optional shared secret for authentication */
  secret?: string
}

/**
 * Deep link trigger config
 */
export interface DeepLinkTriggerConfig {
  type: 'deep-link'
  // URL is auto-generated: craftagents://automation/run/{id}
}

/**
 * App event trigger config
 */
export interface AppEventTriggerConfig {
  type: 'app-event'
  events: ('app-ready' | 'window-focus' | 'window-blur')[]
}

/**
 * Power event trigger config
 */
export interface PowerEventTriggerConfig {
  type: 'power-event'
  events: ('on-ac' | 'on-battery' | 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen')[]
}

/**
 * Clipboard trigger config
 */
export interface ClipboardTriggerConfig {
  type: 'clipboard'
  /** Optional regex pattern to match clipboard content */
  pattern?: string
  /** Poll interval in ms (default 2000) */
  pollIntervalMs?: number
}

/**
 * Folder action trigger config (Hazel-style)
 */
export interface FolderActionTriggerConfig {
  type: 'folder-action'
  /** Folder path to watch */
  folderPath: string
  /** File extension filter (e.g., [".pdf", ".docx"]) */
  extensions?: string[]
  /** File name pattern (glob) */
  namePattern?: string
  /** Minimum file size in bytes */
  minSize?: number
  /** Maximum file size in bytes */
  maxSize?: number
  /** Move processed files to this subfolder */
  doneFolder?: string
}

/**
 * Manual trigger config (no additional config needed)
 */
export interface ManualTriggerConfig {
  type: 'manual'
}

/**
 * Discriminated union of all trigger configurations
 */
export type TriggerConfig =
  | ScheduleTriggerConfig
  | FileChangeTriggerConfig
  | HotkeyTriggerConfig
  | WebhookTriggerConfig
  | DeepLinkTriggerConfig
  | AppEventTriggerConfig
  | PowerEventTriggerConfig
  | ClipboardTriggerConfig
  | FolderActionTriggerConfig
  | ManualTriggerConfig

// ============================================================
// Action Types
// ============================================================

/**
 * Configuration for what happens when an automation triggers
 */
export interface ActionConfig {
  /** Model to use (defaults to workspace default) */
  model?: string
  /** Permission mode for the session */
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  /** Maximum agent turns before stopping */
  maxTurns?: number
  /** Hard timeout in seconds */
  timeoutSeconds?: number
  /** Source slugs this automation can access */
  sourceSlugs?: string[]
  /** Skill slugs to make available */
  skillSlugs?: string[]
  /** Working directory for the session */
  workingDirectory?: string
}

// ============================================================
// Automation Types
// ============================================================

/**
 * Run status for an automation
 */
export type AutomationRunStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled'

/**
 * Last known status of an automation
 */
export type AutomationLastStatus = 'success' | 'failure' | 'running' | null

/**
 * Core automation definition
 */
export interface Automation {
  /** Unique identifier */
  id: string
  /** User-facing name */
  name: string
  /** Natural language instructions for the agent */
  prompt: string
  /** Trigger configuration */
  triggerConfig: TriggerConfig
  /** Action configuration */
  actionConfig: ActionConfig
  /** Whether the automation is active */
  enabled: boolean
  /** ISO timestamp of last run */
  lastRunAt: string | null
  /** ISO timestamp of next scheduled run */
  nextRunAt: string | null
  /** ISO timestamp of creation */
  createdAt: string
  /** ISO timestamp of last modification */
  updatedAt: string
  /** Workspace this automation belongs to */
  workspaceId: string
  /** Total number of runs */
  runCount: number
  /** Status of the most recent run */
  lastStatus: AutomationLastStatus
}

/**
 * Data required to create a new automation
 */
export interface CreateAutomationInput {
  name: string
  prompt: string
  triggerConfig: TriggerConfig
  actionConfig?: ActionConfig
  enabled?: boolean
}

/**
 * Data for updating an existing automation
 */
export interface UpdateAutomationInput {
  name?: string
  prompt?: string
  triggerConfig?: TriggerConfig
  actionConfig?: ActionConfig
  enabled?: boolean
}

/**
 * Record of a single automation execution
 */
export interface AutomationRun {
  /** Unique run identifier */
  id: string
  /** Which automation this run belongs to */
  automationId: string
  /** Current status */
  status: AutomationRunStatus
  /** ISO timestamp when the run started */
  startedAt: string
  /** ISO timestamp when the run completed (null if still running) */
  completedAt: string | null
  /** Session ID for the agent conversation (links to full session) */
  sessionId: string | null
  /** AI-generated summary of what was accomplished */
  summary: string | null
  /** Error message if the run failed */
  error: string | null
  /** What triggered this run */
  triggeredBy: TriggerType
  /** Optional context from the trigger (e.g., file path, webhook payload) */
  triggerContext?: Record<string, unknown>
}

// ============================================================
// Event Types (for IPC communication)
// ============================================================

/**
 * Events emitted by the automation system (main -> renderer)
 */
export type AutomationEvent =
  | { type: 'automation_created'; automation: Automation }
  | { type: 'automation_updated'; automation: Automation }
  | { type: 'automation_deleted'; automationId: string }
  | { type: 'automation_enabled'; automationId: string }
  | { type: 'automation_disabled'; automationId: string }
  | { type: 'run_started'; run: AutomationRun }
  | { type: 'run_completed'; run: AutomationRun }
  | { type: 'run_failed'; run: AutomationRun }
  | { type: 'run_cancelled'; run: AutomationRun }

// ============================================================
// Automation Settings
// ============================================================

/**
 * Global automation settings (stored in workspace config)
 */
export interface AutomationSettings {
  /** Whether automations are enabled for this workspace */
  enabled: boolean
  /** Maximum concurrent automation runs */
  maxConcurrentRuns: number
  /** Port for webhook server (0 = disabled) */
  webhookPort: number
  /** Default timeout in seconds for automation runs */
  defaultTimeout: number
  /** Default max turns for automation runs */
  defaultMaxTurns: number
  /** Default model for automation runs */
  defaultModel: string
  /** Default permission mode for automation runs */
  defaultPermissionMode: 'safe' | 'ask' | 'allow-all'
}

/**
 * Default automation settings
 */
export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  enabled: true,
  maxConcurrentRuns: 2,
  webhookPort: 8421,
  defaultTimeout: 300,
  defaultMaxTurns: 15,
  defaultModel: 'sonnet',
  defaultPermissionMode: 'safe',
}
