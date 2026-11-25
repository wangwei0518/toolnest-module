import type { FormField, TicketNode, VisibilityRule, WorkflowNode } from "../api";

type Values = Record<string, unknown>;

export function hasFormValue(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== "";
}

function visibilityMatches(rule: VisibilityRule, valueFor: (nodeId: string, fieldId: string) => unknown): boolean {
  if (rule.type === "group") {
    const children = rule.children ?? [];
    if (!children.length) return false;
    const matches = (child: VisibilityRule) => visibilityMatches(child, valueFor);
    if (rule.operator === "OR") return children.some(matches);
    return rule.operator === "AND" && children.every(matches);
  }
  const value = valueFor(rule.node_id ?? "", rule.field_id ?? "");
  if (!hasFormValue(value)) return false;
  if (rule.kind === "field_filled") return true;
  if (rule.kind !== "value_compare") return false;
  const expected = rule.value;
  if (rule.operator_value === "=") return String(value) === String(expected ?? null);
  if (rule.operator_value === "!=") return String(value) !== String(expected ?? null);
  const left = typeof value === "boolean" ? Number(value) : decimalValue(value);
  const right = typeof expected === "boolean" ? Number(expected) : decimalValue(expected);
  return Number.isFinite(left) && Number.isFinite(right) &&
    (rule.operator_value === ">" ? left > right : rule.operator_value === "<" && left < right);
}

function decimalValue(value: unknown): number {
  const text = String(value).trim();
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
}

export function conditionalHiddenFields(
  definition: Pick<WorkflowNode, "id" | "form_schema">, values: Values,
  nodes: TicketNode[] = [], definitions: WorkflowNode[] = [],
): Set<string> {
  const conditionalFields = definition.form_schema.fields.filter((field) => field.visibility_rule);
  if (!conditionalFields.length) return new Set();
  const fields = new Map(definitions.map((node) => [node.id, node.form_schema.fields]));
  fields.set(definition.id, definition.form_schema.fields);
  const runtime = new Map(nodes.map((node) => [node.node_id, node]));
  const evaluated = new Map<string, boolean>();
  const fieldVisible = (nodeId: string, field: FormField, sourceValues: Values): boolean => {
    const key = JSON.stringify([nodeId, field.id]);
    const known = evaluated.get(key);
    if (known !== undefined) return known;
    evaluated.set(key, false);
    const visible = !field.visibility_rule || visibilityMatches(field.visibility_rule, (sourceId, fieldId) => {
      const parentId = sourceId || nodeId;
      const parent = runtime.get(parentId);
      const input = parentId === nodeId ? sourceValues : parent?.status === "completed" ? parent.values : undefined;
      const source = fields.get(parentId)?.find((item) => item.id === fieldId);
      return input && source && fieldVisible(parentId, source, input) ? input[fieldId] : undefined;
    });
    evaluated.set(key, visible);
    return visible;
  };
  return new Set(conditionalFields.filter((field) => !fieldVisible(definition.id, field, values)).map((field) => field.id));
}

export function withoutConditionalFields<T>(values: Record<string, T>, hidden: Set<string>): Record<string, T> {
  return hidden.size ? Object.fromEntries(Object.entries(values).filter(([id]) => !hidden.has(id))) : values;
}
