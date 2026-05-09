import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useTheme } from "@tui/context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"

const EFFORTS = ["low", "medium", "high", "xhigh", "max"]

function baseName(modelID: string): string {
  for (const e of EFFORTS) {
    if (modelID.endsWith("-" + e)) return modelID.replace("-" + e, "")
  }
  return modelID
}

function Checkmark(props: { providerID: string; modelID: string }) {
  const local = useLocal()
  const { theme } = useTheme()
  const selected = createMemo(() => local.team.isSelected(props.providerID, props.modelID))
  if (selected()) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Selected</span>
  }
  return <span style={{ fg: theme.textMuted }}>○</span>
}

export function DialogTeamList() {
  const local = useLocal()
  const dialog = useDialog()

  const teams = createMemo(() => local.team.list())

  const options = createMemo(() => {
    const items: any[] = teams().map((t, i) => ({
      value: i,
      title: t.name,
      description: t.members.length >= 2 ? `${t.members.length} models` : "No models",
      footer: i === local.team.activeIndex ? (
        <span style={{ fg: "#0a0" }}>Active</span>
      ) : undefined,
    }))

    items.push({
      value: -1,
      title: "+ Create new team",
      description: "Add a new team with custom models",
    })

    return items
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("d")[0],
      title: "delete",
      onTrigger: (option: { value: number }) => {
        if (option.value >= 0 && teams().length > 1) {
          local.team.delete(option.value)
        }
      },
    },
  ])

  return (
    <DialogSelect<number>
      title="Teams"
      options={options()}
      keybind={keybinds()}
      onSelect={(option) => {
        const v = option.value
        if (v === -1) {
          local.team.create("")
          dialog.replace(() => <DialogTeamModels />)
        } else if (v >= 0) {
          local.team.switchTo(v)
          dialog.replace(() => <DialogTeamModels />)
        }
      }}
    />
  )
}

export function DialogTeamModels() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()

  const connectedIds = createMemo(() => sync.data.provider_next.connected)

  const options = createMemo(() => {
    const ids = connectedIds()
    const _members = local.team.list()[local.team.activeIndex]?.members
    const _len = _members?.length ?? 0

    const validProviders = sync.data.provider
      .filter((p) => ids.includes(p.id))
      .sort((a, b) => {
        if (a.id !== "opencode" && b.id === "opencode") return -1
        if (a.id === "opencode" && b.id !== "opencode") return 1
        return a.name.localeCompare(b.name)
      })
      .filter((p) => p.id !== "opencode")
      .filter((p) => Object.values(p.models).some((m) => m.status !== "deprecated"))

    const favorites = local.model.favorite()

    const providerOptions = validProviders.flatMap((provider) =>
      Object.entries(provider.models)
        .filter(([_, info]) => info.status !== "deprecated")
        .map(([modelID, info]) => ({
          providerID: provider.id,
          modelID,
          title: info.name ?? modelID,
          description: provider.name,
        })),
    )

    // Group by base model name
    const grouped = new Map<string, {
      providerID: string
      baseID: string
      displayName: string
      description: string
      variants: Array<{ modelID: string; title: string; }>
    }>()

    for (const m of providerOptions) {
      const base = baseName(m.modelID)
      const key = m.providerID + ":" + base
      if (!grouped.has(key)) {
        grouped.set(key, {
          providerID: m.providerID,
          baseID: base,
          displayName: base === m.modelID ? m.title : m.title.replace(/\s*\(.*?\)\s*/g, "").trim(),
          description: m.description,
          variants: [],
        })
      }
      grouped.get(key)!.variants.push({ modelID: m.modelID, title: m.title })
      // Remove base variant (model without reasoning level)
      grouped.get(key)!.variants = grouped.get(key)!.variants.filter((v) => v.modelID !== base || grouped.get(key)!.variants.length === 1)
    }

    for (const [_, g] of grouped) {
      g.variants.sort((a, b) => {
        const aIdx = EFFORTS.findIndex((e) => a.modelID.endsWith("-" + e))
        const bIdx = EFFORTS.findIndex((e) => b.modelID.endsWith("-" + e))
        if (aIdx === -1 && bIdx === -1) return 0
        if (aIdx === -1) return 1
        if (bIdx === -1) return -1
        return aIdx - bIdx
      })
    }

    const baseOptions = Array.from(grouped.values())
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((g) => {
        const hasVariants = g.variants.length > 1
        const members = local.team.list()[local.team.activeIndex]?.members ?? []
        const selectedVariant = g.variants.find((v) =>
          members.some((m) => m.providerID === g.providerID && m.modelID === v.modelID),
        )
        const displayTitle = selectedVariant ? selectedVariant.title : g.displayName
        return {
          value: {
            providerID: g.providerID,
            baseID: g.baseID,
            displayName: g.displayName,
            variants: g.variants as Array<{ modelID: string; title: string }>,
            hasVariants,
          },
          title: displayTitle,
          description: g.description,
          footer: selectedVariant
            ? <span style={{ fg: "#0a0" }}>✓ Selected</span>
            : <span style={{ fg: "#666" }}>○</span>,
        }
      })

    const favoritesList = baseOptions
      .filter((o) => favorites.some((f) => f.providerID === o.value.providerID && f.modelID === o.value.baseID))
      .map((o) => ({ ...o, category: "Favorites" }))

    const others = baseOptions.filter(
      (o) => !favorites.some((f) => f.providerID === o.value.providerID && f.modelID === o.value.baseID),
    )

    return favoritesList.length > 0 ? [...favoritesList, ...others] : baseOptions
  })

  function cycleVariant(
    providerID: string,
    variants: Array<{ modelID: string; title: string }>,
    direction: -1 | 1,
  ) {
    const members = local.team.current() ?? []
    let currentIdx = members.findIndex(
      (m) => m.providerID === providerID && variants.some((v) => v.modelID === m.modelID),
    )

    // If member was added as base model (no reasoning suffix), start from first variant
    if (currentIdx < 0) {
      const memberIdx = members.findIndex((m) => m.providerID === providerID)
      if (memberIdx < 0) return
      // Replace base model with first variant
      const updated = [...members]
      updated[memberIdx] = { providerID, modelID: variants[0].modelID }
      local.team.set(updated)
      return
    }

    const currentModelID = members[currentIdx].modelID
    const variantIdx = variants.findIndex((v) => v.modelID === currentModelID)
    if (variantIdx < 0) return

    const nextIdx = (variantIdx + direction + variants.length) % variants.length
    const nextModelID = variants[nextIdx].modelID

    const updated = [...members]
    updated[currentIdx] = { providerID, modelID: nextModelID }
    local.team.set(updated)
  }

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: (option: {
        value: {
          providerID: string
          baseID: string
          variants: Array<{ modelID: string; title: string }>
          hasVariants: boolean
        }
      }) => {
        if (!option.value.hasVariants) {
          local.team.toggle(option.value.providerID, option.value.baseID)
          return
        }
        const members = local.team.current() ?? []
        const alreadySelected = members.find(
          (m) =>
            m.providerID === option.value.providerID &&
            option.value.variants.some((v) => v.modelID === m.modelID),
        )
        if (alreadySelected) {
          local.team.toggle(option.value.providerID, alreadySelected.modelID)
        } else {
          local.team.toggle(option.value.providerID, option.value.variants[0].modelID)
        }
      },
    },
    {
      keybind: Keybind.parse("right")[0],
      title: "→ level",
      onTrigger: (option: {
        value: {
          providerID: string
          baseID: string
          variants: Array<{ modelID: string; title: string }>
          hasVariants: boolean
        }
      }) => {
        if (option.value.hasVariants && option.value.variants.length > 1) {
          cycleVariant(option.value.providerID, option.value.variants, 1)
        }
      },
    },
    {
      keybind: Keybind.parse("left")[0],
      title: "← level",
      onTrigger: (option: {
        value: {
          providerID: string
          baseID: string
          variants: Array<{ modelID: string; title: string }>
          hasVariants: boolean
        }
      }) => {
        if (option.value.hasVariants && option.value.variants.length > 1) {
          cycleVariant(option.value.providerID, option.value.variants, -1)
        }
      },
    },
    {
      keybind: Keybind.parse("ctrl+d")[0],
      title: "clear all",
      onTrigger: () => {
        local.team.clear()
      },
    },
    {
      keybind: Keybind.parse("ctrl+e")[0],
      title: "rename",
      onTrigger: () => {
        dialog.replace(() => (
          <DialogPrompt
            title="Rename Team"
            value={local.team.name}
            onConfirm={(value) => {
              local.team.setName(value)
              dialog.clear()
            }}
            onCancel={() => dialog.replace(() => <DialogTeamModels />)}
          />
        ))
      },
    },
    {
      keybind: Keybind.parse("escape")[0],
      title: "back to teams",
      onTrigger: () => {
        dialog.replace(() => <DialogTeamList />)
      },
    },
  ])

  const count = createMemo(() => local.team.current()?.length ?? 0)

  return (
    <DialogSelect
      title={`${local.team.name}${count() >= 2 ? ` (${count()} models)` : ""}`}
      options={options()}
      keybind={keybinds()}
      onSelect={() => dialog.clear()}
    />
  )
}
