/**
 * AutomationsListPanel
 *
 * Panel component for displaying workspace automations in the sidebar.
 * Styled to match SkillsListPanel with avatar, title, and subtitle layout.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Bot, MoreHorizontal, Play, Pause, Trash2, Copy, Plus, Clock, AlertCircle, CheckCircle2,
  Calendar, FolderOpen, Clipboard as ClipboardIcon, Zap,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import type { Automation, TriggerConfig, CreateAutomationInput } from '@craft-agent/shared/automations'
import type { LoadedSource } from '@craft-agent/shared/sources/types'
import type { LoadedSkill } from '@craft-agent/shared/skills/types'

export interface AutomationsListPanelProps {
  workspaceId: string
  selectedAutomationId?: string | null
  onAutomationClick: (automationId: string) => void
  className?: string
}

export function AutomationsListPanel({
  workspaceId,
  selectedAutomationId,
  onAutomationClick,
  className,
}: AutomationsListPanelProps) {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [sources, setSources] = useState<LoadedSource[]>([])
  const [skills, setSkills] = useState<LoadedSkill[]>([])

  // Load automations
  const loadAutomations = useCallback(async () => {
    try {
      const result = await window.electronAPI.listAutomations(workspaceId)
      setAutomations(result)
    } catch (err) {
      console.error('Failed to load automations:', err)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadAutomations()
    // Load sources and skills for suggestions
    Promise.all([
      window.electronAPI.getSources(workspaceId),
      window.electronAPI.getSkills(workspaceId),
    ]).then(([s, k]) => { setSources(s); setSkills(k) }).catch(() => {})
    // Listen for changes
    const cleanup = window.electronAPI.onAutomationsChanged((updated) => {
      setAutomations(updated)
    })
    return cleanup
  }, [loadAutomations, workspaceId])

  const suggestions = useMemo(() => getQuickStartSuggestions(sources, skills), [sources, skills])

  const handleDelete = useCallback(async (automationId: string) => {
    try {
      await window.electronAPI.deleteAutomation(workspaceId, automationId)
    } catch (err) {
      console.error('Failed to delete automation:', err)
    }
  }, [workspaceId])

  const handleDuplicate = useCallback(async (automationId: string) => {
    try {
      await window.electronAPI.duplicateAutomation(workspaceId, automationId)
    } catch (err) {
      console.error('Failed to duplicate automation:', err)
    }
  }, [workspaceId])

  const handleToggleEnabled = useCallback(async (automation: Automation) => {
    try {
      if (automation.enabled) {
        await window.electronAPI.disableAutomation(workspaceId, automation.id)
      } else {
        await window.electronAPI.enableAutomation(workspaceId, automation.id)
      }
    } catch (err) {
      console.error('Failed to toggle automation:', err)
    }
  }, [workspaceId])

  const handleRunNow = useCallback(async (automationId: string) => {
    try {
      await window.electronAPI.runAutomationNow(workspaceId, automationId)
    } catch (err) {
      console.error('Failed to run automation:', err)
    }
  }, [workspaceId])

  const handleCreateNew = useCallback(async () => {
    try {
      const automation = await window.electronAPI.createAutomation(workspaceId, {
        name: 'New Automation',
        prompt: 'Describe what this automation should do...',
        triggerConfig: { type: 'manual' },
        enabled: false,
      })
      onAutomationClick(automation.id)
    } catch (err) {
      console.error('Failed to create automation:', err)
    }
  }, [workspaceId, onAutomationClick])

  const handleCreateFromSuggestion = useCallback(async (suggestion: QuickStartSuggestion) => {
    try {
      const input: CreateAutomationInput = {
        name: suggestion.name,
        prompt: suggestion.prompt,
        triggerConfig: suggestion.triggerConfig,
        actionConfig: {
          ...(suggestion.sourceSlugs?.length ? { sourceSlugs: suggestion.sourceSlugs } : {}),
          ...(suggestion.skillSlugs?.length ? { skillSlugs: suggestion.skillSlugs } : {}),
        },
        enabled: false,
      }
      const automation = await window.electronAPI.createAutomation(workspaceId, input)
      onAutomationClick(automation.id)
    } catch (err) {
      console.error('Failed to create automation from suggestion:', err)
    }
  }, [workspaceId, onAutomationClick])

  if (loading) {
    return <div className={cn('flex flex-col flex-1', className)} />
  }

  // Empty state
  if (automations.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1', className)}>
        <ScrollArea className="flex-1">
          <Empty className="pt-8 pb-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bot />
              </EmptyMedia>
              <EmptyTitle>No automations yet</EmptyTitle>
              <EmptyDescription>
                Automations run agent tasks on a schedule or in response to events on your Mac.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <button
                onClick={handleCreateNew}
                className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
              >
                <Plus className="h-3 w-3" />
                Create Automation
              </button>
            </EmptyContent>
          </Empty>

          {suggestions.length > 0 && (
            <div className="px-4 pb-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Quick Start</div>
              <div className="space-y-1.5">
                {suggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => handleCreateFromSuggestion(suggestion)}
                    className="flex items-start gap-2.5 w-full p-2.5 rounded-[8px] border border-border/30 hover:border-primary/30 hover:bg-primary/[0.02] transition-colors text-left group"
                  >
                    <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <suggestion.icon className="h-3 w-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium group-hover:text-primary transition-colors">{suggestion.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{suggestion.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      <ScrollArea className="flex-1">
        <div className="pb-2">
          {/* Create new button at top */}
          <div className="px-4 pt-2 pb-1">
            <button
              onClick={handleCreateNew}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" />
              New Automation
            </button>
          </div>
          <div className="pt-1">
            {automations.map((automation, index) => (
              <AutomationItem
                key={automation.id}
                automation={automation}
                isSelected={selectedAutomationId === automation.id}
                isFirst={index === 0}
                onClick={() => onAutomationClick(automation.id)}
                onDelete={() => handleDelete(automation.id)}
                onDuplicate={() => handleDuplicate(automation.id)}
                onToggleEnabled={() => handleToggleEnabled(automation)}
                onRunNow={() => handleRunNow(automation.id)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

interface AutomationItemProps {
  automation: Automation
  isSelected: boolean
  isFirst: boolean
  onClick: () => void
  onDelete: () => void
  onDuplicate: () => void
  onToggleEnabled: () => void
  onRunNow: () => void
}

function AutomationItem({ automation, isSelected, isFirst, onClick, onDelete, onDuplicate, onToggleEnabled, onRunNow }: AutomationItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  // Status indicator
  const StatusIcon = automation.lastStatus === 'success' ? CheckCircle2
    : automation.lastStatus === 'failure' ? AlertCircle
    : automation.lastStatus === 'running' ? Clock
    : null

  const statusColor = automation.lastStatus === 'success' ? 'text-green-500'
    : automation.lastStatus === 'failure' ? 'text-red-500'
    : automation.lastStatus === 'running' ? 'text-yellow-500'
    : ''

  // Trigger type label
  const triggerLabel = automation.triggerConfig.type === 'schedule' ? 'Scheduled'
    : automation.triggerConfig.type === 'file-change' ? 'File Change'
    : automation.triggerConfig.type === 'hotkey' ? 'Hotkey'
    : automation.triggerConfig.type === 'webhook' ? 'Webhook'
    : automation.triggerConfig.type === 'deep-link' ? 'Deep Link'
    : automation.triggerConfig.type === 'app-event' ? 'App Event'
    : automation.triggerConfig.type === 'power-event' ? 'Power Event'
    : automation.triggerConfig.type === 'clipboard' ? 'Clipboard'
    : automation.triggerConfig.type === 'folder-action' ? 'Folder Action'
    : 'Manual'

  return (
    <div data-selected={isSelected ? true : undefined}>
      {!isFirst && (
        <div className="pl-12 pr-4">
          <Separator />
        </div>
      )}
      <div className="relative group select-none pl-2 mr-2">
        {/* Bot avatar */}
        <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
          <div className={cn(
            "w-5 h-5 rounded-md flex items-center justify-center text-xs",
            automation.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}>
            <Bot className="h-3 w-3" />
          </div>
        </div>
        {/* Main content button */}
        <button
          className={cn(
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm transition-all outline-none rounded-[8px]",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
          )}
          onClick={onClick}
        >
          {/* Spacer for avatar */}
          <div className="w-5 h-5 shrink-0" />
          {/* Content column */}
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            {/* Title */}
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                {automation.name}
              </div>
            </div>
            {/* Subtitle - trigger type + status */}
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] pr-6 min-w-0">
              <span className={cn("flex items-center gap-1", !automation.enabled && "opacity-50")}>
                {triggerLabel}
                {!automation.enabled && ' (disabled)'}
              </span>
              {StatusIcon && (
                <StatusIcon className={cn("h-3 w-3 ml-auto shrink-0", statusColor)} />
              )}
            </div>
          </div>
        </button>
        {/* Action buttons - visible on hover */}
        <div
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10",
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </div>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <StyledDropdownMenuItem onClick={onRunNow}>
                  <Play className="h-3.5 w-3.5" />
                  <span>Run Now</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem onClick={onToggleEnabled}>
                  {automation.enabled ? (
                    <>
                      <Pause className="h-3.5 w-3.5" />
                      <span>Disable</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      <span>Enable</span>
                    </>
                  )}
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem onClick={onDuplicate}>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Duplicate</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuSeparator />
                <StyledDropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete</span>
                </StyledDropdownMenuItem>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Quick Start Suggestions
// ============================================================

interface QuickStartSuggestion {
  name: string
  description: string
  prompt: string
  triggerConfig: TriggerConfig
  icon: React.ElementType
  sourceSlugs?: string[]
  skillSlugs?: string[]
}

function getQuickStartSuggestions(sources: LoadedSource[], skills: LoadedSkill[]): QuickStartSuggestion[] {
  const suggestions: QuickStartSuggestion[] = []
  const providers = new Set(sources.map(s => s.config.provider.toLowerCase()))

  if (providers.has('github')) {
    const slug = sources.find(s => s.config.provider.toLowerCase() === 'github')?.config.slug
    suggestions.push({
      name: 'Summarize New PRs',
      description: 'Daily summary of new and updated pull requests',
      prompt: 'Check for any new or updated pull requests and provide a concise summary of each, including the title, author, and key changes.',
      triggerConfig: { type: 'schedule', cron: '0 9 * * 1-5' },
      icon: Calendar,
      sourceSlugs: slug ? [slug] : undefined,
    })
  }

  if (providers.has('linear')) {
    const slug = sources.find(s => s.config.provider.toLowerCase() === 'linear')?.config.slug
    suggestions.push({
      name: 'Daily Standup Summary',
      description: 'Summarize open issues and blockers each morning',
      prompt: 'Summarize all open issues assigned to me, any recently completed issues, and blockers. Format as a standup update.',
      triggerConfig: { type: 'schedule', cron: '0 9 * * 1-5' },
      icon: Calendar,
      sourceSlugs: slug ? [slug] : undefined,
    })
  }

  for (const skill of skills) {
    const slug = skill.slug.toLowerCase()
    if (slug.includes('note') || slug.includes('apple-notes')) {
      suggestions.push({
        name: 'Clipboard to Notes',
        description: 'Save and summarize clipboard content as a note',
        prompt: 'Take the clipboard content, summarize it, and save it as a new note.',
        triggerConfig: { type: 'clipboard' },
        icon: ClipboardIcon,
        skillSlugs: [skill.slug],
      })
    }
  }

  // Always show generic suggestions
  suggestions.push({
    name: 'Watch Downloads Folder',
    description: 'React when new files appear in Downloads',
    prompt: 'A new file appeared in the Downloads folder. Identify its type and suggest what to do with it.',
    triggerConfig: { type: 'folder-action', folderPath: '~/Downloads' },
    icon: FolderOpen,
  })

  suggestions.push({
    name: 'Morning Briefing',
    description: 'Daily summary of calendar, tasks, and priorities',
    prompt: 'Good morning! Provide a brief summary of today\'s calendar, weather, and any pending tasks.',
    triggerConfig: { type: 'schedule', cron: '0 8 * * 1-5' },
    icon: Calendar,
  })

  if (sources.length > 0) {
    suggestions.push({
      name: 'Weekly Activity Report',
      description: 'Friday summary across all connected sources',
      prompt: 'Generate a weekly summary report of activity across all connected sources. Include key metrics, completed tasks, and upcoming items.',
      triggerConfig: { type: 'schedule', cron: '0 10 * * 5' },
      icon: Calendar,
      sourceSlugs: sources.map(s => s.config.slug),
    })
  }

  return suggestions
}
