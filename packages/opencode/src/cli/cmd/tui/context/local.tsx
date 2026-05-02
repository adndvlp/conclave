import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { batch, createEffect, createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { uniqueBy } from "remeda"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { iife } from "@/util/iife"
import { useToast } from "../ui/toast"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { RGBA } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: providerID,
    modelID: rest.join("/"),
  }
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()

    function isModelValid(model: { providerID: string; modelID: string }) {
      const provider = sync.data.provider.find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID]
    }

    function getFirstValidModel(...modelFns: (() => { providerID: string; modelID: string } | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    const agent = iife(() => {
      const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
      const visibleAgents = createMemo(() => sync.data.agent.filter((x) => !x.hidden))
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
      })
      const { theme } = useTheme()
      const colors = createMemo(() => [
        theme.secondary,
        theme.accent,
        theme.success,
        theme.warning,
        theme.primary,
        theme.error,
        theme.info,
      ])
      return {
        list() {
          return agents()
        },
        current() {
          return agents().find((x) => x.name === agentStore.current) ?? agents().at(0)
        },
        set(name: string) {
          if (!agents().some((x) => x.name === name))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${name}`,
              duration: 3000,
            })
          setAgentStore("current", name)
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((x) => x.name === current.name) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            setAgentStore("current", value.name)
          })
        },
        color(name: string) {
          const index = visibleAgents().findIndex((x) => x.name === name)
          if (index === -1) return colors()[0]
          const agent = visibleAgents()[index]

          if (agent?.color) {
            const color = agent.color
            if (color.startsWith("#")) return RGBA.fromHex(color)
            // already validated by config, just satisfying TS here
            return theme[color as keyof typeof theme] as RGBA
          }
          return colors()[index % colors().length]
        },
      }
    })

    const model = iife(() => {
      const [modelStore, setModelStore] = createStore<{
        ready: boolean
        model: Record<
          string,
          {
            providerID: string
            modelID: string
          }
        >
        recent: {
          providerID: string
          modelID: string
        }[]
        favorite: {
          providerID: string
          modelID: string
        }[]
        variant: Record<string, string | undefined>
      }>({
        ready: false,
        model: {},
        recent: [],
        favorite: [],
        variant: {},
      })

      const filePath = path.join(Global.Path.state, "model.json")
      const state = {
        pending: false,
      }

      function save() {
        if (!modelStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void Filesystem.writeJson(filePath, {
          recent: modelStore.recent,
          favorite: modelStore.favorite,
          variant: modelStore.variant,
        })
      }

      Filesystem.readJson(filePath)
        .then((x: any) => {
          if (Array.isArray(x.recent)) setModelStore("recent", x.recent)
          if (Array.isArray(x.favorite)) setModelStore("favorite", x.favorite)
          if (typeof x.variant === "object" && x.variant !== null) setModelStore("variant", x.variant)
        })
        .catch(() => {})
        .finally(() => {
          setModelStore("ready", true)
          if (state.pending) save()
        })

      const args = useArgs()
      const fallbackModel = createMemo(() => {
        if (args.model) {
          const { providerID, modelID } = parseModel(args.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        if (sync.data.config.model) {
          const { providerID, modelID } = parseModel(sync.data.config.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        for (const item of modelStore.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        const provider = sync.data.provider[0]
        if (!provider) return undefined
        const defaultModel = sync.data.provider_default[provider.id]
        const firstModel = Object.values(provider.models)[0]
        const model = defaultModel ?? firstModel?.id
        if (!model) return undefined
        return {
          providerID: provider.id,
          modelID: model,
        }
      })

      const currentModel = createMemo(() => {
        const a = agent.current()
        return (
          getFirstValidModel(
            () => a && modelStore.model[a.name],
            () => a && a.model,
            fallbackModel,
          ) ?? undefined
        )
      })

      return {
        current: currentModel,
        get ready() {
          return modelStore.ready
        },
        recent() {
          return modelStore.recent
        },
        favorite() {
          return modelStore.favorite
        },
        parsed: createMemo(() => {
          const value = currentModel()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
            }
          }
          const provider = sync.data.provider.find((x) => x.id === value.providerID)
          const info = provider?.models[value.modelID]
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? value.modelID,
            reasoning: info?.capabilities?.reasoning ?? false,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentModel()
          if (!current) return
          const recent = modelStore.recent
          const index = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          if (index === -1) return
          let next = index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          const a = agent.current()
          if (!a) return
          setModelStore("model", a.name, { ...val })
          // Switching to individual model deactivates team (preserves members)
          team.disable()
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = modelStore.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentModel()
          let index = -1
          if (current) {
            index = favorites.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          }
          if (index === -1) {
            index = direction === 1 ? 0 : favorites.length - 1
          } else {
            index += direction
            if (index < 0) index = favorites.length - 1
            if (index >= favorites.length) index = 0
          }
          const next = favorites[index]
          if (!next) return
          const a = agent.current()
          if (!a) return
          setModelStore("model", a.name, { ...next })
          // Switching to individual model clears team
          if (teamStore.teams.length > 0) {
            team.clear()
          }
          const uniq = uniqueBy([next, ...modelStore.recent], (x) => `${x.providerID}/${x.modelID}`)
          if (uniq.length > 10) uniq.pop()
          setModelStore(
            "recent",
            uniq.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
          )
          save()
        },
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const a = agent.current()
            if (!a) return
            setModelStore("model", a.name, model)
            if (options?.recent) {
              const uniq = uniqueBy([model, ...modelStore.recent], (x) => `${x.providerID}/${x.modelID}`)
              if (uniq.length > 10) uniq.pop()
              setModelStore(
                "recent",
                uniq.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
              )
              save()
            }
          })
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const exists = modelStore.favorite.some(
              (x) => x.providerID === model.providerID && x.modelID === model.modelID,
            )
            const next = exists
              ? modelStore.favorite.filter((x) => x.providerID !== model.providerID || x.modelID !== model.modelID)
              : [model, ...modelStore.favorite]
            setModelStore(
              "favorite",
              next.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
            )
            save()
          })
        },
        variant: {
          selected() {
            const m = currentModel()
            if (!m) return undefined
            const key = `${m.providerID}/${m.modelID}`
            return modelStore.variant[key]
          },
          current() {
            const v = this.selected()
            if (!v) return undefined
            if (!this.list().includes(v)) return undefined
            return v
          },
          list() {
            const m = currentModel()
            if (!m) return []
            const provider = sync.data.provider.find((x) => x.id === m.providerID)
            const info = provider?.models[m.modelID]
            if (!info?.variants) return []
            return Object.keys(info.variants)
          },
          set(value: string | undefined) {
            const m = currentModel()
            if (!m) return
            const key = `${m.providerID}/${m.modelID}`
            setModelStore("variant", key, value ?? "default")
            save()
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            const current = this.current()
            if (!current) {
              this.set(variants[0])
              return
            }
            const index = variants.indexOf(current)
            if (index === -1 || index === variants.length - 1) {
              this.set(undefined)
              return
            }
            this.set(variants[index + 1])
          },
        },
      }
    })

    const mcp = {
      isEnabled(name: string) {
        const status = sync.data.mcp[name]
        return status?.status === "connected"
      },
      async toggle(name: string) {
        const status = sync.data.mcp[name]
        if (status?.status === "connected") {
          // Disable: disconnect the MCP
          await sdk.client.mcp.disconnect({ name })
        } else {
          // Enable/Retry: connect the MCP (handles disabled, failed, and other states)
          await sdk.client.mcp.connect({ name })
        }
      },
    }

    // Automatically update model when agent changes
    createEffect(() => {
      const value = agent.current()
      if (!value) return
      if (value.model) {
        if (isModelValid(value.model))
          model.set({
            providerID: value.model.providerID,
            modelID: value.model.modelID,
          })
        else
          toast.show({
            variant: "warning",
            message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not valid`,
            duration: 3000,
          })
      }
    })

    const teamFile = path.join(Global.Path.state, "team.json")

    const [teamStore, setTeamStore] = createStore({
      teams: [] as { name: string; members: { providerID: string; modelID: string }[] }[],
      active: 0,
      enabled: false,
      ready: false,
      nextId: 1,
    })

    function saveTeam() {
      if (!teamStore.ready) return
      void Filesystem.writeJson(teamFile, {
        teams: teamStore.teams,
        active: teamStore.active,
        enabled: teamStore.enabled,
        nextId: teamStore.nextId,
      })
    }

    // Load saved teams on startup
    Filesystem.readJson(teamFile)
      .then((x: any) => {
        if (Array.isArray(x.teams)) setTeamStore("teams", x.teams)
        if (typeof x.active === "number") setTeamStore("active", x.active)
        if (typeof x.enabled === "boolean") setTeamStore("enabled", x.enabled)
        if (typeof x.nextId === "number") setTeamStore("nextId", x.nextId)
      })
      .catch(() => {})
      .finally(() => setTeamStore("ready", true))

    const team = {
      get name() {
        const t = teamStore.teams[teamStore.active]
        return t?.name ?? "No team"
      },
      get isEnabled() {
        return teamStore.enabled
      },
      enable() {
        setTeamStore("enabled", true)
        saveTeam()
      },
      disable() {
        setTeamStore("enabled", false)
        saveTeam()
      },
      list() {
        return teamStore.teams
      },
      get activeIndex() {
        return teamStore.active
      },
      switchTo(index: number) {
        setTeamStore("active", index)
        setTeamStore("enabled", true)
        saveTeam()
      },
      current() {
        if (!teamStore.enabled) return undefined
        const t = teamStore.teams[teamStore.active]
        return t && t.members.length >= 2 ? t.members : undefined
      },
      create(name: string) {
        const id = teamStore.nextId
        setTeamStore("teams", (prev) => [...prev, { name: name || `Team ${id}`, members: [] }])
        setTeamStore("active", teamStore.teams.length)
        setTeamStore("nextId", id + 1)
        saveTeam()
      },
      delete(index: number) {
        setTeamStore("teams", (prev) => prev.filter((_, i) => i !== index))
        if (teamStore.active >= teamStore.teams.length - 1) {
          setTeamStore("active", Math.max(0, teamStore.teams.length - 2))
        }
        saveTeam()
      },
      setName(name: string) {
        setTeamStore("teams", teamStore.active, "name", name)
        saveTeam()
      },
      set(members: { providerID: string; modelID: string }[]) {
        setTeamStore("teams", teamStore.active, "members", members)
        saveTeam()
      },
      toggle(providerID: string, modelID: string) {
        setTeamStore("teams", teamStore.active, "members", (prev) => {
          const exists = prev.findIndex((m) => m.providerID === providerID && m.modelID === modelID)
          if (exists >= 0) return prev.filter((_, i) => i !== exists)
          return [...prev, { providerID, modelID }]
        })
        setTeamStore("enabled", true)
        saveTeam()
      },
      isSelected(providerID: string, modelID: string) {
        const t = teamStore.teams[teamStore.active]
        return t?.members.some((m) => m.providerID === providerID && m.modelID === modelID) ?? false
      },
      clear() {
        setTeamStore("teams", teamStore.active, "members", [])
        saveTeam()
      },
    }

    const result = {
      model,
      agent,
      mcp,
      team,
    }
    return result
  },
})
