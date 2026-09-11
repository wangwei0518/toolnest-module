import { RiFileTextLine, RiGitBranchLine, RiLinkM, RiServerLine } from "@remixicon/react"
import type { ComponentType } from "react"

import type { RelatedResource } from "../../api"

export type ResourceType = "server" | "repository" | "document" | "custom"
export type ResourceIcon = ComponentType<{ className?: string }>

export const resourceTypes: Array<{ value: ResourceType; label: string }> = [
  { value: "server", label: "服务器" },
  { value: "repository", label: "代码仓库" },
  { value: "document", label: "文档" },
  { value: "custom", label: "自定义" },
]

export function normalizeResourceType(value?: string | null): ResourceType {
  if (value === "server" || value === "repository" || value === "document" || value === "custom") return value
  return "custom"
}

export function resourceTypeLabel(value: string) {
  return resourceTypes.find((item) => item.value === normalizeResourceType(value))?.label ?? "自定义"
}

export function resourceIcon(value: string): ResourceIcon {
  const type = normalizeResourceType(value)
  return type === "server"
    ? RiServerLine
    : type === "repository"
      ? RiGitBranchLine
      : type === "document"
        ? RiFileTextLine
        : RiLinkM
}

export function resourceSummary(resource: RelatedResource) {
  const type = normalizeResourceType(resource.resource_type ?? resource.type)
  const attributes = resource.attributes ?? {}
  if (type === "server") {
    return [
      resource.identifier,
      attributes.protocol && String(attributes.protocol).toUpperCase(),
      attributes.port && `:${attributes.port}`,
      attributes.environment,
    ].filter(Boolean).join(" ") || "未填写连接信息"
  }
  if (type === "repository") {
    return [
      resource.identifier,
      attributes.provider,
      attributes.branch && `分支 ${attributes.branch}`,
      attributes.path && `目录 ${attributes.path}`,
    ].filter(Boolean).join(" · ") || "未填写仓库信息"
  }
  if (type === "document") {
    return [
      resource.identifier,
      attributes.document_type,
      attributes.version && `版本 ${attributes.version}`,
    ].filter(Boolean).join(" · ") || "未填写文档信息"
  }
  return resource.identifier || resource.description || "未填写资源说明"
}
