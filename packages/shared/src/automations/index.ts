/**
 * Automations Module
 *
 * Re-exports all automations types and storage functions.
 */

// Types
export type {
  TriggerType,
  TriggerConfig,
  ScheduleTriggerConfig,
  FileChangeTriggerConfig,
  HotkeyTriggerConfig,
  WebhookTriggerConfig,
  DeepLinkTriggerConfig,
  AppEventTriggerConfig,
  PowerEventTriggerConfig,
  ClipboardTriggerConfig,
  FolderActionTriggerConfig,
  ManualTriggerConfig,
  ActionConfig,
  AutomationRunStatus,
  AutomationLastStatus,
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
  AutomationRun,
  AutomationEvent,
  AutomationSettings,
} from './types.ts';

export { DEFAULT_AUTOMATION_SETTINGS } from './types.ts';

// Storage
export {
  getWorkspaceAutomationsPath,
  loadAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  duplicateAutomation,
  enableAutomation,
  disableAutomation,
  saveRun,
  getRun,
  loadRuns,
  deleteRun,
  createRun,
  updateRun,
  updateAutomationAfterRun,
} from './storage.ts';
