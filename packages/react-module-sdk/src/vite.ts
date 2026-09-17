/**
 * Package specifiers provided by the React Host shared runtime.
 *
 * Keep this list deliberately explicit. A module must bundle every package
 * outside this list into its own release so that the host never has to guess
 * how to resolve an arbitrary third-party import.
 */
export const TOOLNEST_REACT_SHARED_DEPENDENCY_SPECIFIERS = [
  '@tanstack/react-query',
  '@toolnest/react-module-sdk',
  'axios',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'react-router-dom',
  'sonner',
  'zod',
] as const

export type ToolNestReactSharedDependency =
  (typeof TOOLNEST_REACT_SHARED_DEPENDENCY_SPECIFIERS)[number]

export function isToolNestReactSharedDependency(id: string): boolean {
  return (TOOLNEST_REACT_SHARED_DEPENDENCY_SPECIFIERS as readonly string[]).includes(id)
}
