/**
 * AutomationInfoPage
 *
 * Detail page for viewing and editing a single automation.
 * Shows automation name, prompt, interactive trigger selector,
 * editable action settings, source/skill pickers, and run history.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Bot, Play, Pause, Save, Clock, AlertCircle, CheckCircle2,
  Calendar, File, Keyboard, Globe, Zap, Power, Clipboard, FolderOpen, Hand,
  ChevronDown, Copy, Plus, X, Search,
} from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type {
  Automation,
  AutomationRun,
  TriggerConfig,
  TriggerType,
  ActionConfig,
  UpdateAutomationInput,
} from '@craft-agent/shared/automations'
import type { LoadedSource } from '@craft-agent/shared/sources/types'
import type { LoadedSkill } from '@craft-agent/shared/skills/types'

// ============================================================
// Constants
// ============================================================

const TRIGGER_TYPES: { value: TriggerType; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'manual', label: 'Manual', icon: Hand, description: 'Click "Run Now" to trigger' },
  { value: 'schedule', label: 'Schedule', icon: Calendar, description: 'Run on a cron schedule' },
  { value: 'hotkey', label: 'Keyboard Shortcut', icon: Keyboard, description: 'Trigger with a global hotkey' },
  { value: 'file-change', label: 'File Change', icon: File, description: 'Watch files for changes' },
  { value: 'folder-action', label: 'Folder Action', icon: FolderOpen, description: 'React to new files in a folder' },
  { value: 'clipboard', label: 'Clipboard', icon: Clipboard, description: 'Monitor clipboard content' },
  { value: 'power-event', label: 'Power Event', icon: Power, description: 'React to sleep, wake, lock, etc.' },
  { value: 'app-event', label: 'App Event', icon: Bot, description: 'React to app lifecycle events' },
  { value: 'deep-link', label: 'Deep Link', icon: Zap, description: 'Trigger via URL scheme' },
  { value: 'webhook', label: 'Webhook', icon: Globe, description: 'Trigger via HTTP request' },
]

const PERMISSION_MODES = [
  { value: 'safe', label: 'Safe', description: 'Read-only, no writes' },
  { value: 'ask', label: 'Ask', description: 'Prompts before edits' },
  { value: 'allow-all', label: 'Allow All', description: 'Full autonomous execution' },
]

const MODELS = [
  { value: 'default', label: 'Default (Workspace)' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
]

const TIMEOUT_PRESETS = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 },
]

const POWER_EVENTS = [
  { value: 'suspend', label: 'Sleep' },
  { value: 'resume', label: 'Wake' },
  { value: 'lock-screen', label: 'Lock Screen' },
  { value: 'unlock-screen', label: 'Unlock Screen' },
  { value: 'on-ac', label: 'On AC Power' },
  { value: 'on-battery', label: 'On Battery' },
] as const

const APP_EVENTS = [
  { value: 'app-ready', label: 'App Ready' },
  { value: 'window-focus', label: 'Window Focus' },
  { value: 'window-blur', label: 'Window Blur' },
] as const

// ============================================================
// Suggestion Templates
// ============================================================

interface SuggestionTemplate {
  name: string
  prompt: string
  triggerConfig: TriggerConfig
  actionConfig?: Partial<ActionConfig>
  matchSource?: string
  matchSkill?: string
}

function getSuggestions(sources: LoadedSource[], skills: LoadedSkill[]): SuggestionTemplate[] {
  const suggestions: SuggestionTemplate[] = []
  const sourceProviders = new Set(sources.map(s => s.config.provider.toLowerCase()))
  const skillSlugs = new Set(skills.map(s => s.slug.toLowerCase()))

  if (sourceProviders.has('github')) {
    suggestions.push({
      name: 'Summarize New PRs',
      prompt: 'Check for any new or updated pull requests and provide a concise summary of each, including the title, author, and key changes.',
      triggerConfig: { type: 'schedule', cron: '0 9 * * 1-5' },
      matchSource: 'github',
    })
  }

  if (sourceProviders.has('linear')) {
    suggestions.push({
      name: 'Daily Standup Summary',
      prompt: 'Summarize all open issues assigned to me, any recently completed issues, and blockers. Format as a standup update.',
      triggerConfig: { type: 'schedule', cron: '0 9 * * 1-5' },
      matchSource: 'linear',
    })
  }

  if (sourceProviders.has('slack')) {
    suggestions.push({
      name: 'Monitor Alerts Channel',
      prompt: 'Check the #alerts channel for any new messages and summarize any actionable items or incidents.',
      triggerConfig: { type: 'schedule', cron: '*/30 * * * *' },
      matchSource: 'slack',
    })
  }

  for (const skill of skills) {
    const slug = skill.slug.toLowerCase()
    if (slug.includes('note') || slug.includes('apple-notes')) {
      suggestions.push({
        name: 'Clipboard to Notes',
        prompt: 'Take the clipboard content, summarize it, and save it as a new note.',
        triggerConfig: { type: 'clipboard' },
        matchSkill: skill.slug,
      })
    }
    if (slug.includes('mail') || slug.includes('email')) {
      suggestions.push({
        name: 'Daily Email Digest',
        prompt: 'Compose a digest of today\'s activity across all connected sources and draft an email summary.',
        triggerConfig: { type: 'schedule', cron: '0 17 * * 1-5' },
        matchSkill: skill.slug,
      })
    }
  }

  if (sources.length > 0) {
    suggestions.push({
      name: 'Weekly Activity Report',
      prompt: 'Generate a weekly summary report of activity across all connected sources. Include key metrics, completed tasks, and upcoming items.',
      triggerConfig: { type: 'schedule', cron: '0 10 * * 5' },
    })
  }

  // Always show some generic suggestions
  suggestions.push({
    name: 'Watch Downloads Folder',
    prompt: 'A new file appeared in the Downloads folder. Identify its type and suggest what to do with it.',
    triggerConfig: {
      type: 'folder-action',
      folderPath: '~/Downloads',
    },
  })

  suggestions.push({
    name: 'Morning Briefing',
    prompt: 'Good morning! Provide a brief summary of today\'s calendar, weather, and any pending tasks.',
    triggerConfig: { type: 'schedule', cron: '0 8 * * 1-5' },
  })

  return suggestions
}

// ============================================================
// Main Component
// ============================================================

interface AutomationInfoPageProps {
  automationId: string
  workspaceId: string
}

export default function AutomationInfoPage({ automationId, workspaceId }: AutomationInfoPageProps) {
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [loading, setLoading] = useState(true)

  // Editable fields
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [triggerConfig, setTriggerConfig] = useState<TriggerConfig>({ type: 'manual' })
  const [actionConfig, setActionConfig] = useState<ActionConfig>({})
  const [isDirty, setIsDirty] = useState(false)

  // Sources and skills
  const [sources, setSources] = useState<LoadedSource[]>([])
  const [skills, setSkills] = useState<LoadedSkill[]>([])

  // Load automation data
  const loadAutomation = useCallback(async () => {
    try {
      const result = await window.electronAPI.getAutomation(workspaceId, automationId)
      if (result) {
        setAutomation(result)
        setName(result.name)
        setPrompt(result.prompt)
        setTriggerConfig(result.triggerConfig)
        setActionConfig(result.actionConfig)
        setIsDirty(false)
      }
    } catch (err) {
      console.error('Failed to load automation:', err)
    } finally {
      setLoading(false)
    }
  }, [workspaceId, automationId])

  // Load runs
  const loadRuns = useCallback(async () => {
    try {
      const result = await window.electronAPI.listAutomationRuns(workspaceId, automationId)
      setRuns(result)
    } catch (err) {
      console.error('Failed to load runs:', err)
    }
  }, [workspaceId, automationId])

  // Load sources and skills
  const loadSourcesAndSkills = useCallback(async () => {
    try {
      const [loadedSources, loadedSkills] = await Promise.all([
        window.electronAPI.getSources(workspaceId),
        window.electronAPI.getSkills(workspaceId),
      ])
      setSources(loadedSources)
      setSkills(loadedSkills)
    } catch (err) {
      console.error('Failed to load sources/skills:', err)
    }
  }, [workspaceId])

  useEffect(() => {
    setLoading(true)
    loadAutomation()
    loadRuns()
    loadSourcesAndSkills()

    const cleanupEvents = window.electronAPI.onAutomationEvent((event) => {
      if (event.type === 'run_started' || event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled') {
        if (event.run.automationId === automationId) {
          loadRuns()
          loadAutomation()
        }
      }
    })

    const cleanupChanged = window.electronAPI.onAutomationsChanged(() => {
      loadAutomation()
    })

    return () => {
      cleanupEvents()
      cleanupChanged()
    }
  }, [automationId, loadAutomation, loadRuns, loadSourcesAndSkills])

  const handleSave = useCallback(async () => {
    if (!automation) return
    const updates: UpdateAutomationInput = {}
    if (name !== automation.name) updates.name = name
    if (prompt !== automation.prompt) updates.prompt = prompt
    if (JSON.stringify(triggerConfig) !== JSON.stringify(automation.triggerConfig)) {
      updates.triggerConfig = triggerConfig
    }
    if (JSON.stringify(actionConfig) !== JSON.stringify(automation.actionConfig)) {
      updates.actionConfig = actionConfig
    }
    if (Object.keys(updates).length > 0) {
      await window.electronAPI.updateAutomation(workspaceId, automationId, updates)
      setIsDirty(false)
    }
  }, [automation, name, prompt, triggerConfig, actionConfig, workspaceId, automationId])

  const handleToggleEnabled = useCallback(async () => {
    if (!automation) return
    if (automation.enabled) {
      await window.electronAPI.disableAutomation(workspaceId, automationId)
    } else {
      await window.electronAPI.enableAutomation(workspaceId, automationId)
    }
  }, [automation, workspaceId, automationId])

  const handleRunNow = useCallback(async () => {
    await window.electronAPI.runAutomationNow(workspaceId, automationId)
  }, [workspaceId, automationId])

  const markDirty = useCallback(() => setIsDirty(true), [])

  const updateTriggerConfig = useCallback((updates: Partial<TriggerConfig> | TriggerConfig) => {
    setTriggerConfig(prev => {
      if ('type' in updates && updates.type !== prev.type) {
        return updates as TriggerConfig
      }
      return { ...prev, ...updates } as TriggerConfig
    })
    markDirty()
  }, [markDirty])

  const updateActionConfig = useCallback((updates: Partial<ActionConfig>) => {
    setActionConfig(prev => ({ ...prev, ...updates }))
    markDirty()
  }, [markDirty])

  // Suggestions based on sources/skills
  const suggestions = useMemo(
    () => getSuggestions(sources, skills),
    [sources, skills],
  )

  if (loading || !automation) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={automation.name}
        actions={
          <div className="flex items-center gap-1">
            {isDirty && (
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1 h-7 px-2.5 text-xs font-medium rounded-[8px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Save className="h-3 w-3" />
                Save
              </button>
            )}
            <button
              onClick={handleRunNow}
              className="inline-flex items-center gap-1 h-7 px-2.5 text-xs font-medium rounded-[8px] bg-foreground/[0.05] hover:bg-foreground/[0.08] transition-colors"
            >
              <Play className="h-3 w-3" />
              Run Now
            </button>
            <button
              onClick={handleToggleEnabled}
              className={cn(
                "inline-flex items-center gap-1 h-7 px-2.5 text-xs font-medium rounded-[8px] transition-colors",
                automation.enabled
                  ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
                  : "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.08]"
              )}
            >
              {automation.enabled ? (
                <>
                  <Pause className="h-3 w-3" />
                  Enabled
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  Disabled
                </>
              )}
            </button>
          </div>
        }
      />

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6 max-w-2xl">
          {/* Name */}
          <Section label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); markDirty() }}
              className="w-full px-3 py-2 text-sm rounded-[8px] bg-foreground/[0.03] border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
              placeholder="Automation name"
            />
          </Section>

          {/* Prompt */}
          <Section label="Instructions">
            <textarea
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); markDirty() }}
              rows={6}
              className="w-full px-3 py-2 text-sm rounded-[8px] bg-foreground/[0.03] border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors resize-y font-mono"
              placeholder="Describe what this automation should do..."
            />
          </Section>

          {/* Trigger */}
          <Section label="Trigger">
            <TriggerSelector
              config={triggerConfig}
              automationId={automationId}
              onChange={updateTriggerConfig}
            />
          </Section>

          {/* Action Settings */}
          <Section label="Action Settings">
            <ActionSettingsEditor
              config={actionConfig}
              sources={sources}
              skills={skills}
              onChange={updateActionConfig}
            />
          </Section>

          {/* Suggestions */}
          {automation.name === 'New Automation' && suggestions.length > 0 && (
            <Section label="Quick Start">
              <p className="text-xs text-muted-foreground mb-3">
                Pre-built automations based on your installed sources and skills
              </p>
              <div className="grid grid-cols-1 gap-2">
                {suggestions.slice(0, 5).map((suggestion, i) => (
                  <SuggestionCard
                    key={i}
                    suggestion={suggestion}
                    onApply={() => {
                      setName(suggestion.name)
                      setPrompt(suggestion.prompt)
                      setTriggerConfig(suggestion.triggerConfig)
                      if (suggestion.actionConfig) {
                        setActionConfig(prev => ({ ...prev, ...suggestion.actionConfig }))
                      }
                      if (suggestion.matchSource) {
                        setActionConfig(prev => ({
                          ...prev,
                          sourceSlugs: [...(prev.sourceSlugs || []), suggestion.matchSource!],
                        }))
                      }
                      if (suggestion.matchSkill) {
                        setActionConfig(prev => ({
                          ...prev,
                          skillSlugs: [...(prev.skillSlugs || []), suggestion.matchSkill!],
                        }))
                      }
                      markDirty()
                    }}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Stats */}
          <Section label="Stats">
            <div className="grid grid-cols-3 gap-3">
              <InfoCard label="Total Runs" value={String(automation.runCount)} />
              <InfoCard
                label="Last Run"
                value={automation.lastRunAt
                  ? new Date(automation.lastRunAt).toLocaleDateString()
                  : 'Never'
                }
              />
              <InfoCard
                label="Last Status"
                value={automation.lastStatus || 'N/A'}
                valueClassName={
                  automation.lastStatus === 'success' ? 'text-green-500'
                  : automation.lastStatus === 'failure' ? 'text-red-500'
                  : ''
                }
              />
            </div>
          </Section>

          {/* Run History */}
          {runs.length > 0 && (
            <Section label={`Recent Runs (${runs.length})`}>
              <div className="space-y-1">
                {runs.slice(0, 10).map((run) => (
                  <RunItem key={run.id} run={run} />
                ))}
              </div>
            </Section>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================================
// Section wrapper
// ============================================================

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

// ============================================================
// Trigger Selector
// ============================================================

function TriggerSelector({
  config,
  automationId,
  onChange,
}: {
  config: TriggerConfig
  automationId: string
  onChange: (config: TriggerConfig) => void
}) {
  const handleTypeChange = (newType: string) => {
    const type = newType as TriggerType
    // Build a default config for the new trigger type
    switch (type) {
      case 'manual': onChange({ type: 'manual' }); break
      case 'schedule': onChange({ type: 'schedule', cron: '0 9 * * *' }); break
      case 'hotkey': onChange({ type: 'hotkey', accelerator: 'CommandOrControl+Shift+A' }); break
      case 'file-change': onChange({ type: 'file-change', paths: [], events: ['change'], debounceMs: 5000 }); break
      case 'folder-action': onChange({ type: 'folder-action', folderPath: '' }); break
      case 'clipboard': onChange({ type: 'clipboard', pollIntervalMs: 2000 }); break
      case 'power-event': onChange({ type: 'power-event', events: ['resume'] }); break
      case 'app-event': onChange({ type: 'app-event', events: ['window-focus'] }); break
      case 'deep-link': onChange({ type: 'deep-link' }); break
      case 'webhook': onChange({ type: 'webhook' }); break
    }
  }

  const triggerInfo = TRIGGER_TYPES.find(t => t.value === config.type)
  const TriggerIcon = triggerInfo?.icon || Bot

  return (
    <div className="space-y-3">
      {/* Type selector */}
      <Select value={config.type} onValueChange={handleTypeChange}>
        <SelectTrigger className="w-full h-10 rounded-[8px] bg-foreground/[0.03] border-border/50">
          <div className="flex items-center gap-2">
            <TriggerIcon className="h-4 w-4 text-primary" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent>
          {TRIGGER_TYPES.map((t) => {
            const Icon = t.icon
            return (
              <SelectItem key={t.value} value={t.value}>
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t.label}</span>
                  <span className="text-muted-foreground ml-1">— {t.description}</span>
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      {/* Per-trigger config */}
      <div className="rounded-[8px] bg-foreground/[0.02] border border-border/30 p-3">
        <TriggerConfigForm config={config} automationId={automationId} onChange={onChange} />
      </div>
    </div>
  )
}

function TriggerConfigForm({
  config,
  automationId,
  onChange,
}: {
  config: TriggerConfig
  automationId: string
  onChange: (config: TriggerConfig) => void
}) {
  switch (config.type) {
    case 'manual':
      return <p className="text-xs text-muted-foreground">No configuration needed. Click "Run Now" to trigger this automation.</p>

    case 'schedule':
      return <ScheduleConfig config={config} onChange={onChange} />

    case 'hotkey':
      return <HotkeyConfig config={config} onChange={onChange} />

    case 'file-change':
      return <FileChangeConfig config={config} onChange={onChange} />

    case 'folder-action':
      return <FolderActionConfig config={config} onChange={onChange} />

    case 'clipboard':
      return <ClipboardConfig config={config} onChange={onChange} />

    case 'power-event':
      return <PowerEventConfig config={config} onChange={onChange} />

    case 'app-event':
      return <AppEventConfig config={config} onChange={onChange} />

    case 'deep-link':
      return <DeepLinkConfig automationId={automationId} />

    case 'webhook':
      return <WebhookConfig config={config} automationId={automationId} onChange={onChange} />

    default:
      return <p className="text-xs text-muted-foreground">Unknown trigger type.</p>
  }
}

// --- Schedule ---
function ScheduleConfig({ config, onChange }: { config: { type: 'schedule'; cron?: string; rrule?: string; timezone?: string }; onChange: (c: TriggerConfig) => void }) {
  const cronPresets = [
    { label: 'Every hour', cron: '0 * * * *' },
    { label: 'Every day at 9am', cron: '0 9 * * *' },
    { label: 'Every weekday at 9am', cron: '0 9 * * 1-5' },
    { label: 'Every Monday at 10am', cron: '0 10 * * 1' },
    { label: 'Every Friday at 5pm', cron: '0 17 * * 5' },
  ]

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Cron Expression</label>
        <input
          type="text"
          value={config.cron || ''}
          onChange={(e) => onChange({ ...config, cron: e.target.value })}
          className="w-full px-3 py-1.5 text-sm rounded-md bg-background border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 font-mono"
          placeholder="0 9 * * *"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cronPresets.map((preset) => (
          <button
            key={preset.cron}
            onClick={() => onChange({ ...config, cron: preset.cron })}
            className={cn(
              "px-2 py-1 text-xs rounded-md border transition-colors",
              config.cron === preset.cron
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border/30 text-muted-foreground hover:bg-foreground/[0.03]"
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Timezone</label>
        <input
          type="text"
          value={config.timezone || ''}
          onChange={(e) => onChange({ ...config, timezone: e.target.value || undefined })}
          className="w-full px-3 py-1.5 text-sm rounded-md bg-background border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
          placeholder="System default (e.g., America/Chicago)"
        />
      </div>
      {config.cron && (
        <p className="text-xs text-muted-foreground">
          Preview: {describeCron(config.cron)}
        </p>
      )}
    </div>
  )
}

function describeCron(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length !== 5) return cron

  const [min, hour, dom, mon, dow] = parts

  // Simple human-readable for common patterns
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour, on the hour'
  if (min === '0' && dom === '*' && mon === '*' && dow === '*') return `Every day at ${hour}:00`
  if (min === '0' && dom === '*' && mon === '*' && dow === '1-5') return `Every weekday at ${hour}:00`
  if (min === '0' && dom === '*' && mon === '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dowNum = parseInt(dow)
    if (!isNaN(dowNum) && dowNum >= 0 && dowNum <= 6) {
      return `Every ${days[dowNum]} at ${hour}:00`
    }
  }
  if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`

  return cron
}

// --- Hotkey ---
function HotkeyConfig({ config, onChange }: { config: { type: 'hotkey'; accelerator: string }; onChange: (c: TriggerConfig) => void }) {
  const [recording, setRecording] = useState(false)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()

    const parts: string[] = []
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')

    const key = e.key
    if (!['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
      parts.push(key.length === 1 ? key.toUpperCase() : key)
      onChange({ ...config, accelerator: parts.join('+') })
      setRecording(false)
    }
  }, [recording, config, onChange])

  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground">Keyboard Shortcut</label>
      <div className="flex items-center gap-2">
        <div
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onFocus={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          className={cn(
            "flex-1 px-3 py-2 text-sm rounded-md border transition-colors cursor-pointer font-mono",
            recording
              ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
              : "border-border/50 bg-background hover:border-border"
          )}
        >
          {recording ? (
            <span className="text-primary animate-pulse">Press your shortcut...</span>
          ) : (
            <span>{formatAccelerator(config.accelerator)}</span>
          )}
        </div>
        <button
          onClick={() => setRecording(true)}
          className="px-2.5 py-1.5 text-xs rounded-md border border-border/50 text-muted-foreground hover:bg-foreground/[0.03] transition-colors"
        >
          {recording ? 'Listening...' : 'Record'}
        </button>
      </div>
    </div>
  )
}

function formatAccelerator(acc: string): string {
  return acc
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', '⌃')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace(/\+/g, ' ')
}

// --- File Change ---
function FileChangeConfig({ config, onChange }: { config: { type: 'file-change'; paths: string[]; events: ('add' | 'change' | 'unlink')[]; patterns?: string[]; debounceMs?: number }; onChange: (c: TriggerConfig) => void }) {
  const [newPath, setNewPath] = useState('')

  const addPath = async () => {
    const selected = await window.electronAPI.openFolderDialog()
    if (selected) {
      onChange({ ...config, paths: [...config.paths, selected] })
    }
  }

  const removePath = (index: number) => {
    onChange({ ...config, paths: config.paths.filter((_, i) => i !== index) })
  }

  const toggleEvent = (event: 'add' | 'change' | 'unlink') => {
    const events = config.events.includes(event)
      ? config.events.filter(e => e !== event)
      : [...config.events, event]
    onChange({ ...config, events })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Watch Paths</label>
        {config.paths.map((path, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex-1 px-2 py-1 text-xs font-mono rounded bg-foreground/[0.03] border border-border/30 truncate">{path}</span>
            <button onClick={() => removePath(i)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          onClick={addPath}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add folder...
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">File Events</label>
        <div className="flex gap-2">
          {(['add', 'change', 'unlink'] as const).map(event => (
            <label key={event} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Switch
                checked={config.events.includes(event)}
                onCheckedChange={() => toggleEvent(event)}
                className="scale-75"
              />
              <span className="capitalize">{event === 'unlink' ? 'Delete' : event}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Glob Patterns (optional)</label>
        <input
          type="text"
          value={(config.patterns || []).join(', ')}
          onChange={(e) => {
            const patterns = e.target.value.split(',').map(p => p.trim()).filter(Boolean)
            onChange({ ...config, patterns: patterns.length ? patterns : undefined })
          }}
          className="w-full px-3 py-1.5 text-sm rounded-md bg-background border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 font-mono"
          placeholder="*.md, **/*.ts"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Debounce (ms)</label>
        <input
          type="number"
          value={config.debounceMs ?? 5000}
          onChange={(e) => onChange({ ...config, debounceMs: parseInt(e.target.value) || 5000 })}
          className="w-24 px-3 py-1.5 text-sm rounded-md bg-background border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
          min={100}
          max={60000}
        />
      </div>
    </div>
  )
}

// --- Folder Action ---
function FolderActionConfig({ config, onChange }: { config: { type: 'folder-action'; folderPath: string; extensions?: string[]; namePattern?: string; doneFolder?: string }; onChange: (c: TriggerConfig) => void }) {
  const pickFolder = async () => {
    const selected = await window.electronAPI.openFolderDialog()
    if (selected) {
      onChange({ ...config, folderPath: selected })
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Watch Folder</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={config.folderPath}
            onChange={(e) => onChange({ ...config, folderPath: e.target.value })}
            className="flex-1 px-3 py-1.5 text-sm rounded-md bg-background border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 font-mono"
            placeholder="/Users/you/Downloads"
          />
          <button onClick={pickFolder} className="px-2.5 py-1.5 text-xs rounded-md border border-border/50 text-muted-foreground hover:bg-foreground/[0.03] transition-colors">
            Browse...
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">File Extensions (optional)</label>
        <input
          type="text"
          value={(config.extensions || []).join(', ')}
          onChange={(e) => {
            const exts = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
            onChange({ ...config, extensions: exts.length ? exts : undefined })
          }}
          className="w-full px-3 py-1.5 text-sm rounded-md bg-background border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 font-mono"
          placeholder=".pdf, .docx, .png"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Name Pattern (optional)</label>
        <input
          type="text"
          value={config.namePattern || ''}
          onChange={(e) => onChange({ ...config, namePattern: e.target.value || undefined })}
          className="w-full px-3 py-1.5 text-sm rounded-md bg-background border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 font-mono"
          placeholder="report-*.pdf"
        />
      </div>
    </div>
  )
}

// --- Clipboard ---
function ClipboardConfig({ config, onChange }: { config: { type: 'clipboard'; pattern?: string; pollIntervalMs?: number }; onChange: (c: TriggerConfig) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Regex Pattern (optional)</label>
        <input
          type="text"
          value={config.pattern || ''}
          onChange={(e) => onChange({ ...config, pattern: e.target.value || undefined })}
          className="w-full px-3 py-1.5 text-sm rounded-md bg-background border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 font-mono"
          placeholder="https?://.*  (leave empty for any change)"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Poll Interval (ms)</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={500}
            max={10000}
            step={500}
            value={config.pollIntervalMs ?? 2000}
            onChange={(e) => onChange({ ...config, pollIntervalMs: parseInt(e.target.value) })}
            className="flex-1 h-1.5 accent-primary"
          />
          <span className="text-xs text-muted-foreground w-14 text-right font-mono">{config.pollIntervalMs ?? 2000}ms</span>
        </div>
      </div>
    </div>
  )
}

// --- Power Event ---
function PowerEventConfig({ config, onChange }: { config: { type: 'power-event'; events: string[] }; onChange: (c: TriggerConfig) => void }) {
  const toggleEvent = (event: string) => {
    const events = config.events.includes(event)
      ? config.events.filter(e => e !== event)
      : [...config.events, event]
    onChange({ ...config, events } as TriggerConfig)
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-muted-foreground">Events to listen for</label>
      <div className="grid grid-cols-2 gap-1.5">
        {POWER_EVENTS.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/[0.02] cursor-pointer">
            <Switch
              checked={config.events.includes(value)}
              onCheckedChange={() => toggleEvent(value)}
              className="scale-75"
            />
            <span className="text-xs">{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// --- App Event ---
function AppEventConfig({ config, onChange }: { config: { type: 'app-event'; events: string[] }; onChange: (c: TriggerConfig) => void }) {
  const toggleEvent = (event: string) => {
    const events = config.events.includes(event)
      ? config.events.filter(e => e !== event)
      : [...config.events, event]
    onChange({ ...config, events } as TriggerConfig)
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-muted-foreground">Events to listen for</label>
      <div className="space-y-1">
        {APP_EVENTS.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/[0.02] cursor-pointer">
            <Switch
              checked={config.events.includes(value)}
              onCheckedChange={() => toggleEvent(value)}
              className="scale-75"
            />
            <span className="text-xs">{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// --- Deep Link ---
function DeepLinkConfig({ automationId }: { automationId: string }) {
  const url = `craftagents://action/run-automation/${automationId}`
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground">Trigger this automation by opening this URL</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-3 py-1.5 text-xs font-mono rounded-md bg-foreground/[0.03] border border-border/30 truncate select-all">{url}</code>
        <button
          onClick={handleCopy}
          className="px-2.5 py-1.5 text-xs rounded-md border border-border/50 text-muted-foreground hover:bg-foreground/[0.03] transition-colors flex items-center gap-1"
        >
          <Copy className="h-3 w-3" />
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

// --- Webhook ---
function WebhookConfig({ config, automationId, onChange }: { config: { type: 'webhook'; path?: string; secret?: string }; automationId: string; onChange: (c: TriggerConfig) => void }) {
  const path = config.path || `/automations/${automationId}/trigger`

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Webhook Path</label>
        <code className="block px-3 py-1.5 text-xs font-mono rounded-md bg-foreground/[0.03] border border-border/30">{path}</code>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Secret (optional)</label>
        <input
          type="password"
          value={config.secret || ''}
          onChange={(e) => onChange({ ...config, secret: e.target.value || undefined })}
          className="w-full px-3 py-1.5 text-sm rounded-md bg-background border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
          placeholder="Shared secret for authentication"
        />
      </div>
    </div>
  )
}

// ============================================================
// Action Settings Editor
// ============================================================

function ActionSettingsEditor({
  config,
  sources,
  skills,
  onChange,
}: {
  config: ActionConfig
  sources: LoadedSource[]
  skills: LoadedSkill[]
  onChange: (updates: Partial<ActionConfig>) => void
}) {
  const toggleSource = (slug: string) => {
    const current = config.sourceSlugs || []
    const updated = current.includes(slug)
      ? current.filter(s => s !== slug)
      : [...current, slug]
    onChange({ sourceSlugs: updated })
  }

  const toggleSkill = (slug: string) => {
    const current = config.skillSlugs || []
    const updated = current.includes(slug)
      ? current.filter(s => s !== slug)
      : [...current, slug]
    onChange({ skillSlugs: updated })
  }

  const pickWorkingDir = async () => {
    const selected = await window.electronAPI.openFolderDialog()
    if (selected) {
      onChange({ workingDirectory: selected })
    }
  }

  return (
    <div className="space-y-4">
      {/* Permission Mode */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Permission Mode</label>
        <Select value={config.permissionMode || 'safe'} onValueChange={(v) => onChange({ permissionMode: v as ActionConfig['permissionMode'] })}>
          <SelectTrigger className="w-full h-9 rounded-[8px] bg-foreground/[0.03] border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_MODES.map((mode) => (
              <SelectItem key={mode.value} value={mode.value}>
                <span>{mode.label}</span>
                <span className="text-muted-foreground ml-1">— {mode.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Model</label>
        <Select value={config.model || 'default'} onValueChange={(v) => onChange({ model: v === 'default' ? undefined : v })}>
          <SelectTrigger className="w-full h-9 rounded-[8px] bg-foreground/[0.03] border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Max Turns */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Max Turns</label>
        <input
          type="number"
          value={config.maxTurns ?? 15}
          onChange={(e) => onChange({ maxTurns: parseInt(e.target.value) || 15 })}
          className="w-24 px-3 py-1.5 text-sm rounded-md bg-foreground/[0.03] border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
          min={1}
          max={100}
        />
      </div>

      {/* Timeout */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Timeout (seconds)</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={config.timeoutSeconds ?? 300}
            onChange={(e) => onChange({ timeoutSeconds: parseInt(e.target.value) || 300 })}
            className="w-24 px-3 py-1.5 text-sm rounded-md bg-foreground/[0.03] border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
            min={30}
            max={3600}
          />
          <div className="flex gap-1">
            {TIMEOUT_PRESETS.map((preset) => (
              <button
                key={preset.seconds}
                onClick={() => onChange({ timeoutSeconds: preset.seconds })}
                className={cn(
                  "px-2 py-1 text-xs rounded-md border transition-colors",
                  (config.timeoutSeconds ?? 300) === preset.seconds
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "border-border/30 text-muted-foreground hover:bg-foreground/[0.03]"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Working Directory */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Working Directory</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={config.workingDirectory || ''}
            onChange={(e) => onChange({ workingDirectory: e.target.value || undefined })}
            className="flex-1 px-3 py-1.5 text-sm rounded-md bg-foreground/[0.03] border border-border/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 font-mono"
            placeholder="Default (workspace root)"
          />
          <button onClick={pickWorkingDir} className="px-2.5 py-1.5 text-xs rounded-md border border-border/50 text-muted-foreground hover:bg-foreground/[0.03] transition-colors">
            Browse...
          </button>
        </div>
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Sources</label>
          <div className="rounded-[8px] border border-border/30 divide-y divide-border/20">
            {sources.map((source) => (
              <label key={source.config.slug} className="flex items-center gap-2.5 px-3 py-2 hover:bg-foreground/[0.02] cursor-pointer">
                <Switch
                  checked={(config.sourceSlugs || []).includes(source.config.slug)}
                  onCheckedChange={() => toggleSource(source.config.slug)}
                  className="scale-75"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{source.config.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{source.config.provider} · {source.config.type}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Skills</label>
          <div className="rounded-[8px] border border-border/30 divide-y divide-border/20">
            {skills.map((skill) => (
              <label key={skill.slug} className="flex items-center gap-2.5 px-3 py-2 hover:bg-foreground/[0.02] cursor-pointer">
                <Switch
                  checked={(config.skillSlugs || []).includes(skill.slug)}
                  onCheckedChange={() => toggleSkill(skill.slug)}
                  className="scale-75"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{skill.metadata.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{skill.metadata.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Suggestion Card
// ============================================================

function SuggestionCard({ suggestion, onApply }: { suggestion: SuggestionTemplate; onApply: () => void }) {
  const triggerInfo = TRIGGER_TYPES.find(t => t.value === suggestion.triggerConfig.type)
  const TriggerIcon = triggerInfo?.icon || Bot

  return (
    <button
      onClick={onApply}
      className="flex items-start gap-3 p-3 rounded-[8px] border border-border/30 hover:border-primary/30 hover:bg-primary/[0.02] transition-colors text-left w-full group"
    >
      <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <TriggerIcon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium group-hover:text-primary transition-colors">{suggestion.name}</div>
        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{suggestion.prompt}</div>
        <div className="text-xs text-muted-foreground/60 mt-1">{triggerInfo?.label} trigger</div>
      </div>
    </button>
  )
}

// ============================================================
// Shared Components
// ============================================================

function InfoCard({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="px-3 py-2 rounded-[8px] bg-foreground/[0.02] border border-border/30">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-medium mt-0.5", valueClassName)}>{value}</div>
    </div>
  )
}

function RunItem({ run }: { run: AutomationRun }) {
  const StatusIcon = run.status === 'success' ? CheckCircle2
    : run.status === 'failure' ? AlertCircle
    : run.status === 'running' ? Clock
    : run.status === 'cancelled' ? Pause
    : Clock

  const statusColor = run.status === 'success' ? 'text-green-500'
    : run.status === 'failure' ? 'text-red-500'
    : run.status === 'running' ? 'text-yellow-500'
    : 'text-muted-foreground'

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-[8px] hover:bg-foreground/[0.02] transition-colors">
      <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusColor)} />
      <div className="flex-1 min-w-0">
        <div className="text-xs">
          <span className="font-medium">{run.status}</span>
          {run.summary && (
            <span className="text-muted-foreground ml-1">— {run.summary}</span>
          )}
          {run.error && (
            <span className="text-red-500 ml-1">— {run.error}</span>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground shrink-0">
        {new Date(run.startedAt).toLocaleString(undefined, {
          month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })}
      </div>
    </div>
  )
}
