import { RiArrowDownSLine, RiCheckLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CompactSelect({ value, label, options, onChange, className }: { value: string; label?: string; options: readonly (readonly [string | number, string])[]; onChange: (value: string) => void; className?: string }) {
  return <Select value={value} onValueChange={(next) => { if (next !== null) onChange(String(next)); }}><SelectTrigger className={className}><SelectValue>{options.find(([key]) => String(key) === value)?.[1] ?? label}</SelectValue></SelectTrigger><SelectContent><SelectGroup>{options.map(([key, text]) => <SelectItem key={String(key)} value={String(key)}>{text}</SelectItem>)}</SelectGroup></SelectContent></Select>;
}

export function MultiSelectMenu({ label, values, options, onChange, exclusiveValue = "all", fallbackValue = exclusiveValue }: { label: string; values: string[]; options: readonly (readonly [string, string])[]; onChange: (values: string[]) => void; exclusiveValue?: string; fallbackValue?: string }) {
  const exclusiveLabel = options.find(([value]) => value === exclusiveValue)?.[1] ?? label;
  return <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="outline" />}><span>{values.includes(exclusiveValue) ? exclusiveLabel : `${label} ${values.length} 项`}</span><RiArrowDownSLine data-icon="inline-end" /></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuGroup>{options.map(([value, text]) => <DropdownMenuCheckboxItem key={value} checked={values.includes(value)} onCheckedChange={(checked) => { const next = checked ? [...new Set([...values.filter((item) => item !== exclusiveValue), value])] : values.filter((item) => item !== value); onChange(value === exclusiveValue && checked ? [exclusiveValue] : next.length ? next : [fallbackValue]); }}>{values.includes(value) ? <RiCheckLine data-icon="inline-start" /> : null}{text}</DropdownMenuCheckboxItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>;
}
