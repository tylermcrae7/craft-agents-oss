/**
 * Automations Atom
 *
 * Simple atom for storing workspace automations.
 */

import { atom } from 'jotai'
import type { Automation, AutomationRun } from '@craft-agent/shared/automations'

/**
 * Atom to store the current workspace's automations.
 */
export const automationsAtom = atom<Automation[]>([])

/**
 * Atom to store automation runs (keyed by automation ID)
 */
export const automationRunsAtom = atom<Record<string, AutomationRun[]>>({})
