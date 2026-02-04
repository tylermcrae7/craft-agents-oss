/**
 * Automations Storage
 *
 * JSON-file persistence for automations and run history.
 * Automations are stored in {workspace}/automations/ directory.
 *
 * File structure:
 *   automations/
 *   ├── config.json          # Array of Automation objects
 *   └── runs/
 *       ├── {runId}.json     # Individual run results
 *       └── ...
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import type {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './types.ts';

// ============================================================
// Path Helpers
// ============================================================

/**
 * Get the automations directory for a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function getWorkspaceAutomationsPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'automations');
}

/**
 * Get the config file path for automations
 */
function getConfigPath(workspaceRoot: string): string {
  return join(getWorkspaceAutomationsPath(workspaceRoot), 'config.json');
}

/**
 * Get the runs directory for automations
 */
function getRunsPath(workspaceRoot: string): string {
  return join(getWorkspaceAutomationsPath(workspaceRoot), 'runs');
}

/**
 * Ensure the automations directory structure exists
 */
function ensureDir(workspaceRoot: string): void {
  const automationsDir = getWorkspaceAutomationsPath(workspaceRoot);
  if (!existsSync(automationsDir)) {
    mkdirSync(automationsDir, { recursive: true });
  }
  const runsDir = getRunsPath(workspaceRoot);
  if (!existsSync(runsDir)) {
    mkdirSync(runsDir, { recursive: true });
  }
}

// ============================================================
// ID Generation
// ============================================================

/**
 * Generate a short unique ID for automations/runs
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

// ============================================================
// Automation CRUD
// ============================================================

/**
 * Load all automations for a workspace
 */
export function loadAutomations(workspaceRoot: string): Automation[] {
  const configPath = getConfigPath(workspaceRoot);
  if (!existsSync(configPath)) {
    return [];
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Save all automations for a workspace
 */
function saveAutomations(workspaceRoot: string, automations: Automation[]): void {
  ensureDir(workspaceRoot);
  const configPath = getConfigPath(workspaceRoot);
  writeFileSync(configPath, JSON.stringify(automations, null, 2), 'utf-8');
}

/**
 * Get a single automation by ID
 */
export function getAutomation(workspaceRoot: string, automationId: string): Automation | null {
  const automations = loadAutomations(workspaceRoot);
  return automations.find(a => a.id === automationId) ?? null;
}

/**
 * Create a new automation
 */
export function createAutomation(
  workspaceRoot: string,
  workspaceId: string,
  input: CreateAutomationInput,
): Automation {
  const automations = loadAutomations(workspaceRoot);
  const now = new Date().toISOString();

  const automation: Automation = {
    id: generateId(),
    name: input.name,
    prompt: input.prompt,
    triggerConfig: input.triggerConfig,
    actionConfig: input.actionConfig ?? {},
    enabled: input.enabled ?? false,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: now,
    updatedAt: now,
    workspaceId,
    runCount: 0,
    lastStatus: null,
  };

  automations.push(automation);
  saveAutomations(workspaceRoot, automations);
  return automation;
}

/**
 * Update an existing automation
 */
export function updateAutomation(
  workspaceRoot: string,
  automationId: string,
  input: UpdateAutomationInput,
): Automation | null {
  const automations = loadAutomations(workspaceRoot);
  const index = automations.findIndex(a => a.id === automationId);
  if (index === -1) return null;

  const existing = automations[index];
  const updated: Automation = {
    ...existing,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.prompt !== undefined && { prompt: input.prompt }),
    ...(input.triggerConfig !== undefined && { triggerConfig: input.triggerConfig }),
    ...(input.actionConfig !== undefined && { actionConfig: input.actionConfig }),
    ...(input.enabled !== undefined && { enabled: input.enabled }),
    updatedAt: new Date().toISOString(),
  };

  automations[index] = updated;
  saveAutomations(workspaceRoot, automations);
  return updated;
}

/**
 * Delete an automation and its run history
 */
export function deleteAutomation(workspaceRoot: string, automationId: string): boolean {
  const automations = loadAutomations(workspaceRoot);
  const index = automations.findIndex(a => a.id === automationId);
  if (index === -1) return false;

  automations.splice(index, 1);
  saveAutomations(workspaceRoot, automations);

  // Clean up run history for this automation
  const runs = loadRuns(workspaceRoot, automationId);
  for (const run of runs) {
    deleteRun(workspaceRoot, run.id);
  }

  return true;
}

/**
 * Duplicate an automation
 */
export function duplicateAutomation(
  workspaceRoot: string,
  automationId: string,
): Automation | null {
  const original = getAutomation(workspaceRoot, automationId);
  if (!original) return null;

  return createAutomation(workspaceRoot, original.workspaceId, {
    name: `${original.name} (copy)`,
    prompt: original.prompt,
    triggerConfig: original.triggerConfig,
    actionConfig: original.actionConfig,
    enabled: false, // Duplicates start disabled
  });
}

/**
 * Enable an automation
 */
export function enableAutomation(workspaceRoot: string, automationId: string): Automation | null {
  return updateAutomation(workspaceRoot, automationId, { enabled: true });
}

/**
 * Disable an automation
 */
export function disableAutomation(workspaceRoot: string, automationId: string): Automation | null {
  return updateAutomation(workspaceRoot, automationId, { enabled: false });
}

// ============================================================
// Run History CRUD
// ============================================================

/**
 * Save a run result
 */
export function saveRun(workspaceRoot: string, run: AutomationRun): void {
  ensureDir(workspaceRoot);
  const runPath = join(getRunsPath(workspaceRoot), `${run.id}.json`);
  writeFileSync(runPath, JSON.stringify(run, null, 2), 'utf-8');
}

/**
 * Get a single run by ID
 */
export function getRun(workspaceRoot: string, runId: string): AutomationRun | null {
  const runPath = join(getRunsPath(workspaceRoot), `${runId}.json`);
  if (!existsSync(runPath)) return null;

  try {
    const content = readFileSync(runPath, 'utf-8');
    return JSON.parse(content) as AutomationRun;
  } catch {
    return null;
  }
}

/**
 * Load all runs for a specific automation, sorted by startedAt (newest first)
 */
export function loadRuns(workspaceRoot: string, automationId: string): AutomationRun[] {
  const runsDir = getRunsPath(workspaceRoot);
  if (!existsSync(runsDir)) return [];

  try {
    const files = readdirSync(runsDir).filter(f => f.endsWith('.json'));
    const runs: AutomationRun[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(runsDir, file), 'utf-8');
        const run = JSON.parse(content) as AutomationRun;
        if (run.automationId === automationId) {
          runs.push(run);
        }
      } catch {
        // Skip malformed run files
      }
    }

    // Sort newest first
    runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return runs;
  } catch {
    return [];
  }
}

/**
 * Delete a run
 */
export function deleteRun(workspaceRoot: string, runId: string): boolean {
  const runPath = join(getRunsPath(workspaceRoot), `${runId}.json`);
  if (!existsSync(runPath)) return false;

  try {
    unlinkSync(runPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new run record
 */
export function createRun(
  workspaceRoot: string,
  automationId: string,
  triggeredBy: AutomationRun['triggeredBy'],
  triggerContext?: Record<string, unknown>,
): AutomationRun {
  const run: AutomationRun = {
    id: generateId(),
    automationId,
    status: 'pending',
    startedAt: new Date().toISOString(),
    completedAt: null,
    sessionId: null,
    summary: null,
    error: null,
    triggeredBy,
    triggerContext,
  };

  saveRun(workspaceRoot, run);
  return run;
}

/**
 * Update a run's status and metadata
 */
export function updateRun(
  workspaceRoot: string,
  runId: string,
  updates: Partial<Pick<AutomationRun, 'status' | 'completedAt' | 'sessionId' | 'summary' | 'error'>>,
): AutomationRun | null {
  const run = getRun(workspaceRoot, runId);
  if (!run) return null;

  const updated: AutomationRun = { ...run, ...updates };
  saveRun(workspaceRoot, updated);
  return updated;
}

/**
 * Update automation metadata after a run completes
 */
export function updateAutomationAfterRun(
  workspaceRoot: string,
  automationId: string,
  run: AutomationRun,
): void {
  const automations = loadAutomations(workspaceRoot);
  const index = automations.findIndex(a => a.id === automationId);
  if (index === -1) return;

  const automation = automations[index];
  automation.lastRunAt = run.completedAt ?? run.startedAt;
  automation.lastStatus = run.status === 'success' ? 'success'
    : run.status === 'failure' ? 'failure'
    : run.status === 'running' ? 'running'
    : automation.lastStatus;
  automation.runCount += 1;
  automation.updatedAt = new Date().toISOString();

  automations[index] = automation;
  saveAutomations(workspaceRoot, automations);
}
