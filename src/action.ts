import type { DockClientScriptContext } from '@vitejs/devtools-kit/client'
import { deactivateInspectorOnDevtoolsNavigation, getInspectorController } from './inspector.js'

const initializedEntries = new WeakSet<object>()

export default function setupInspectorAction(context: DockClientScriptContext): void {
  const controller = getInspectorController()
  controller.setRpc(context.rpc)
  deactivateInspectorOnDevtoolsNavigation(context)
  if (initializedEntries.has(context.current)) {
    if (context.current.isActive) controller.activate()
    return
  }
  initializedEntries.add(context.current)
  context.current.events.on('entry:activated', () => controller.activate())
  context.current.events.on('entry:deactivated', () => controller.deactivate())
  // Devframe initializes a non-eager action script after emitting its first
  // activation event, so honor the current state on initial setup as well.
  if (context.current.isActive) controller.activate()
  // When the inspector turns itself off (after a pick, Escape, ...) release the
  // dock entry too, so the Inspect icon doesn't stay selected.
  let wasActive = controller.active
  controller.subscribe(() => {
    const isActive = controller.active
    if (wasActive && !isActive && context.current.isActive) void context.docks?.switchEntry(null)
    wasActive = isActive
  })
}
