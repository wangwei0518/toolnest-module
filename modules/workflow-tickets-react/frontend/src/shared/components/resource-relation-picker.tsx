import { useMemo, useState } from "react"
import { RiArrowDownSLine, RiCloseLine } from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type Identifiable = { id: string }

export function ResourceRelationPicker<T extends Identifiable>({
  label,
  items,
  selectedIds,
  onChange,
  getLabel,
  getMeta,
  emptyMessage = "暂无可关联项",
}: {
  label: string
  items: T[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  getLabel: (item: T) => string
  getMeta?: (item: T) => string
  emptyMessage?: string
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState("")
  const selected = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds])
  const filtered = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    if (!query) return items
    return items.filter((item) => `${getLabel(item)} ${getMeta?.(item) ?? ""}`.toLocaleLowerCase().includes(query))
  }, [getLabel, getMeta, items, keyword])
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id])

  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setKeyword("") }}>
        <PopoverTrigger render={<Button type="button" variant="outline" className="w-full justify-between text-left font-normal" />}>
          <span>{selected.length ? `已选择 ${selected.length} 项` : `选择${label}`}</span>
          <RiArrowDownSLine className="size-3.5 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={`搜索${label}`} />
            <CommandList>
              {filtered.length ? <CommandGroup heading={label}>{filtered.map((item) => {
                const checked = selectedIds.includes(item.id)
                return <CommandItem key={item.id} value={item.id} data-checked={checked} onSelect={() => toggle(item.id)}>
                  <Checkbox checked={checked} tabIndex={-1} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{getLabel(item)}</span>
                  {getMeta ? <span className="max-w-32 truncate text-muted-foreground">{getMeta(item)}</span> : null}
                </CommandItem>
              })}</CommandGroup> : <CommandEmpty>{items.length ? "没有匹配项" : emptyMessage}</CommandEmpty>}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length ? <div className="flex flex-wrap gap-1.5">
        {selected.map((item) => <Badge key={item.id} variant="secondary" className="max-w-full">
          <span className="max-w-48 truncate">{getLabel(item)}</span>
          <button type="button" className="ml-0.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" aria-label={`移除${getLabel(item)}`} onClick={() => toggle(item.id)}>
            <RiCloseLine className="size-3" />
          </button>
        </Badge>)}
      </div> : null}
    </div>
  )
}
