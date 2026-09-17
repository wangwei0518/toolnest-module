import type { ReactNode } from 'react'

export const TOOLNEST_REACT_MODULE_SDK_VERSION = '0.1.0'

export type ToolNestModuleContentLayout = 'padded' | 'flush'

export interface ToolNestModuleApiClient {
  get<T>(url: string, config?: unknown): Promise<T>
  post<T>(url: string, data?: unknown, config?: unknown): Promise<T>
  put<T>(url: string, data?: unknown, config?: unknown): Promise<T>
  patch<T>(url: string, data?: unknown, config?: unknown): Promise<T>
  delete<T>(url: string, config?: unknown): Promise<T>
}

export interface ToolNestModuleRouter {
  push(to: string | { path: string; search?: string }): Promise<unknown> | unknown
  replace?(to: string | { path: string; search?: string }): Promise<unknown> | unknown
  back?(): void
  afterEach?(guard: (to: { path: string }) => void): () => void
}

export interface ToolNestModuleMenuItem {
  key: string
  label: string
  path: string
  icon?: string
  order?: number
  hidden?: boolean
  children?: ToolNestModuleMenuChildItem[]
}

export interface ToolNestModuleMenuChildItem {
  key: string
  label: string
  path: string
  icon?: string
  order?: number
  hidden?: boolean
}

export interface ToolNestModuleRouteRenderProps {
  moduleId: string
  path: string
  params: Record<string, string>
  query: Record<string, string>
  router: ToolNestModuleRouter
}

export interface ToolNestModuleRoute {
  key: string
  path: string
  render: (props: ToolNestModuleRouteRenderProps) => ReactNode
}

export interface ToolNestModuleWidget {
  id: string
  title: string
  description?: string
  defaultVisible?: boolean
  render: (props: { width: number; height: number }) => ReactNode
}

export interface ToolNestModuleNotificationOptions {
  type?: 'success' | 'info' | 'warning' | 'error'
  title?: string
  content: string
}

export interface ToolNestModuleConfirmOptions {
  title?: string
  content: string
}

export type ToolNestModuleTheme = 'light' | 'dark'

export interface ToolNestModuleContext {
  moduleId: string
  releaseId: string
  signal: AbortSignal
  onDispose(callback: () => void | Promise<void>): void
  registerRoutes(routes: ToolNestModuleRoute[]): () => void
  registerMenus(menus: ToolNestModuleMenuItem[]): () => void
  registerPermissions(permissions: string[]): () => void
  registerDashboardWidgets(widgets: ToolNestModuleWidget[]): () => void
  router: ToolNestModuleRouter
  apiClient: ToolNestModuleApiClient
  getLocale(): string
  getTheme(): ToolNestModuleTheme
  getTimezone(): string
  getSdkVersion(): string
  notify(options: ToolNestModuleNotificationOptions): void
  confirm(options: ToolNestModuleConfirmOptions): Promise<boolean>
}

export interface ToolNestReactFrontendModule {
  id: string
  version: string
  layout?: { content?: ToolNestModuleContentLayout }
  install(context: ToolNestModuleContext): void | Promise<void>
  uninstall?(context: ToolNestModuleContext): void | Promise<void>
}
