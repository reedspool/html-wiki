import { x } from "./imported-from-loaded-file.mts"

// This is TypeScript party.
const Default = 45 * 88
export default Default

export const y = x * 30

export function exportedFunction() {
  return "exported successfully (relative)"
}
