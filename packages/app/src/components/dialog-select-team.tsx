import { Component, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal, type ModelKey } from "@/context/local"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useLanguage } from "@/context/language"

function modelKey(m: { providerID: string; modelID: string }) {
  return `${m.providerID}:${m.modelID}`
}

export const DialogSelectTeam: Component = () => {
  const dialog = useDialog()
  const local = useLocal()
  const language = useLanguage()

  const current = createMemo(() => {
    const t = local.team.current()
    return new Set(t?.map(modelKey) ?? [])
  })

  const [store, setStore] = createStore<{ selected: Set<string> }>({
    selected: new Set(current()),
  })

  const models = createMemo(() =>
    local.model
      .list()
      .filter((m) => local.model.visible({ modelID: m.id, providerID: m.provider.id }))
      .sort((a, b) => {
        const ai = popularProviders.indexOf(a.provider.id)
        const bi = popularProviders.indexOf(b.provider.id)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return a.name.localeCompare(b.name)
      }),
  )

  const toggle = (key: string) => {
    setStore("selected", (prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const confirm = () => {
    const members: ModelKey[] = models()
      .filter((m) => store.selected.has(modelKey({ providerID: m.provider.id, modelID: m.id })))
      .map((m) => ({ providerID: m.provider.id, modelID: m.id }))
    local.team.set(members)
    dialog.close()
  }

  const count = createMemo(() => store.selected.size)

  return (
    <Dialog
      title={language.t("dialog.team.select.title")}
      action={
        <Show when={count() > 0}>
          <Button
            class="h-7 -my-1 text-14-medium"
            onClick={() => {
              setStore("selected", new Set())
            }}
            variant="ghost"
          >
            {language.t("dialog.team.clear")}
          </Button>
        </Show>
      }
    >
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.model.empty")}
        key={(x) => modelKey({ providerID: x.provider.id, modelID: x.id })}
        items={models}
        filterKeys={["provider.name", "name", "id"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(x) => x.provider.name}
        sortGroupsBy={(a, b) => {
          const aProvider = a.items[0].provider.id
          const bProvider = b.items[0].provider.id
          if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
          if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
          return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
        }}
        onSelect={(x) => {
          if (!x) return
          toggle(modelKey({ providerID: x.provider.id, modelID: x.id }))
        }}
      >
        {(i) => {
          const key = modelKey({ providerID: i.provider.id, modelID: i.id })
          const checked = createMemo(() => store.selected.has(key))
          return (
            <div class="w-full flex items-center gap-x-2 text-13-regular">
              <div
                class="size-4 shrink-0 rounded border border-border-base flex items-center justify-center"
                classList={{ "bg-accent-base border-accent-base": checked() }}
              >
                <Show when={checked()}>
                  <Icon name="check-small" class="text-white size-3" />
                </Show>
              </div>
              <span class="truncate">{i.name}</span>
              <span class="ml-auto text-11-regular text-text-weak shrink-0">{i.provider.name}</span>
            </div>
          )
        }}
      </List>
      <div class="px-3 pt-3 pb-4 flex items-center gap-2">
        <Button
          class="flex-1 text-14-medium"
          onClick={confirm}
          disabled={count() < 2}
        >
          <Show when={count() >= 2} fallback={language.t("dialog.team.select.needsTwo")}>
            {language.t("dialog.team.select.confirm", { count: count() })}
          </Show>
        </Button>
      </div>
    </Dialog>
  )
}
