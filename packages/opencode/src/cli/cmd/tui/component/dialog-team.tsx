import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useTheme } from "@tui/context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"

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
    // Force re-compute on any team change by accessing members directly
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
        .sort(([_, a], [__, b]) => (a.name ?? "").localeCompare(b.name ?? ""))
        .map(([modelID, info]) => ({
          value: { providerID: provider.id, modelID },
          title: info.name ?? modelID,
          description: provider.name,
          footer: <Checkmark providerID={provider.id} modelID={modelID} />,
        })),
    )

    const favoritesList = providerOptions
      .filter((o) => favorites.some((f) => f.providerID === o.value.providerID && f.modelID === o.value.modelID))
      .map((o) => ({ ...o, category: "Favorites" }))

    const others = providerOptions.filter(
      (o) => !favorites.some((f) => f.providerID === o.value.providerID && f.modelID === o.value.modelID),
    )

    return favoritesList.length > 0 ? [...favoritesList, ...others] : providerOptions
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: (option: { value: { providerID: string; modelID: string } }) => {
        local.team.toggle(option.value.providerID, option.value.modelID)
      },
    },
    {
      keybind: Keybind.parse("c")[0],
      title: "clear all",
      onTrigger: () => {
        local.team.clear()
      },
    },
    {
      keybind: Keybind.parse("r")[0],
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
      keybind: Keybind.parse("backspace")[0],
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
