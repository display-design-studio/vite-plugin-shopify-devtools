import type { DockClientScriptContext } from '@vitejs/devtools-kit/client'
import { getInspectorController } from './inspector.js'

const initializedEntries = new WeakSet<object>()

export default function setupInspectorAction(context: DockClientScriptContext): void {
  const controller = getInspectorController()
  controller.setRpc(context.rpc)
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
}
