import type { Provider } from "@/provider/provider"
import type { ModelMessage } from "ai"
import type { CrossTeamMessage } from "./schema"

export function buildDeliberationPrompt(input: {
  self: Provider.Model
  teammates: Provider.Model[]
  task: string
  thread: string
  round: number
  maxRounds: number
  allowBreak?: boolean
}): ModelMessage[] {
  const teamContext = [input.self, ...input.teammates]
    .map(
      (m) =>
        `- ${m.name} (${m.providerID}/${m.id}): context=${m.limit?.context ?? "?"}k, ` +
        `capabilities=${Object.entries(m.capabilities ?? {})
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(", ")}`,
    )
    .join("\n")

  const teamList = [input.self, ...input.teammates].map((m) => m.name).join(", ")
  const breakSignal = input.allowBreak
    ? `BREAK:<equipo>:<foco>[:<modelo1>,<modelo2>]  — propones sub-equipo, opcionalmente invitas compañeros\n` +
      `  Ej: BREAK:backend:API y auth:${input.teammates[0]?.name ?? "ModeloX"}\n` +
      `  Ej: BREAK:frontend:UI e integración\n` +
      `  Modelos disponibles para invitar: ${teamList}\n`
    : ""

  const signalInstructions =
    input.round === 1
      ? `Ronda ${input.round}/${input.maxRounds} — primera impresión. No has leído las respuestas de tus compañeros aún.

Emite EXACTAMENTE UNA señal al final de tu mensaje:
PROPOSE:<tu enfoque>   — tu propuesta inicial
QUESTION:<duda>        — si necesitas aclarar algo crítico antes de proponer
${breakSignal}PASS                   — si no tienes nada que aportar`
      : `Ronda ${input.round}/${input.maxRounds} — ya tienes el hilo completo de tu equipo arriba.

Emite EXACTAMENTE UNA señal al final de tu mensaje:
LEAD:<razón>                        — tomas ownership, explica por qué tú
SUPPORT:<nombre>:<razón>            — respaldas el liderazgo de alguien con argumento concreto
ALIGN:<nombre>:<razón>              — te convencieron, di por qué
BUILD:<qué agregas>                 — algo nuevo sobre lo que ya está propuesto
CHALLENGE:<punto específico>        — objeción concreta (no "necesita más análisis")
SYNTHESIZE:<combina ideas de X e Y> — fusionas propuestas en algo mejor
EXTEND:<razón>                      — el equipo necesita más rondas (si mayoría vota, se agregan)
PASS                                — nada que añadir`

  const system = `Eres ${input.self.name}, parte de un equipo de modelos resolviendo un task de código.

Tu perfil:
- Provider: ${input.self.providerID}
- Context window: ${input.self.limit?.context ?? "?"}k tokens
- Capabilities: ${Object.entries(input.self.capabilities ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ")}

Equipo completo:
${teamContext}

TASK: ${input.task}

El objetivo es la mejor solución. No hay egos — construye sobre ideas ajenas, desafía con razón concreta.
Puedes asumir un rol si lo ves útil. El equipo se auto-organiza.

---
${signalInstructions}`

  const messages: ModelMessage[] = [{ role: "system", content: system }]

  if (input.thread) {
    messages.push({
      role: "user",
      content: `Hilo del equipo hasta ahora:\n\n${input.thread}\n\nTu respuesta:`,
    })
  } else {
    messages.push({ role: "user", content: "Tu respuesta:" })
  }

  return messages
}

export function buildSubTeamPrompt(input: {
  self: Provider.Model
  teammates: Provider.Model[]
  teamName: string
  focus: string
  task: string
  thread: string
  crossTeamMessages: CrossTeamMessage[]
  round: number
  maxRounds: number
}): ModelMessage[] {
  const teammateContext = input.teammates
    .map((m) => `- ${m.name} (${m.providerID}/${m.id})`)
    .join("\n")

  const crossTeamSection =
    input.crossTeamMessages.length > 0
      ? `\nMensajes de otros equipos:\n${input.crossTeamMessages
          .map((m) => `[${m.fromTeam}]: ${m.message}`)
          .join("\n")}\n`
      : ""

  const signalInstructions =
    input.round === 1
      ? `Ronda interna ${input.round}/${input.maxRounds} — primera ronda de tu sub-equipo.

Emite EXACTAMENTE UNA señal al final de tu mensaje:
PROPOSE:<tu enfoque>   — tu propuesta inicial para el foco de este equipo
QUESTION:<duda>        — si necesitas aclarar algo
PASS                   — nada que aportar`
      : `Ronda interna ${input.round}/${input.maxRounds}.

Emite EXACTAMENTE UNA señal al final de tu mensaje:
LEAD:<razón>                        — tomas ownership en este sub-equipo
SUPPORT:<nombre>:<razón>            — respaldas el liderazgo de alguien
ALIGN:<nombre>:<razón>              — te convencieron
BUILD:<qué agregas>                 — algo nuevo sobre lo propuesto
CHALLENGE:<punto específico>        — objeción concreta
SYNTHESIZE:<combina ideas de X e Y> — fusionas propuestas
EXTEND:<razón>                      — necesitan más rondas internas
PASS                                — nada que añadir`

  const system = `Eres ${input.self.name}, parte del sub-equipo "${input.teamName}".

FOCO DE TU EQUIPO: ${input.focus}

Tu sub-equipo:
${teammateContext ? `${input.self.name} (tú)\n${teammateContext}` : `${input.self.name} (tú — único miembro)`}
${crossTeamSection}
TASK GLOBAL: ${input.task}

Trabaja exclusivamente en el foco de tu sub-equipo. Los otros equipos se encargan del resto.

---
${signalInstructions}`

  const messages: ModelMessage[] = [{ role: "system", content: system }]

  if (input.thread) {
    messages.push({
      role: "user",
      content: `Hilo de tu sub-equipo:\n\n${input.thread}\n\nTu respuesta:`,
    })
  } else {
    messages.push({ role: "user", content: "Tu respuesta:" })
  }

  return messages
}

export function buildGlobalRoundPrompt(input: {
  self: Provider.Model
  myTeamName: string
  myTeamSummary: string
  otherTeamsSummaries: Array<{ name: string; summary: string }>
  task: string
  globalRound: number
}): ModelMessage[] {
  const otherTeamsSection = input.otherTeamsSummaries
    .map((t) => `**${t.name}**:\n${t.summary}`)
    .join("\n\n")

  const system = `Eres ${input.self.name}, ronda de coordinación global entre sub-equipos.

TASK: ${input.task}

Esta es una ronda de coordinación. Los sub-equipos han completado su ciclo interno.
Aquí el resumen de progreso de cada equipo para que puedas coordinar.

Tu sub-equipo (${input.myTeamName}):
${input.myTeamSummary}

Otros equipos:
${otherTeamsSection}

---
Ronda global ${input.globalRound}.

Si necesitas comunicar algo a los otros equipos (preguntas, dependencias, bloqueos), usa BROADCAST.
Si no tienes nada que comunicar y tu equipo puede continuar trabajando, usa PASS.

Emite EXACTAMENTE UNA señal al final de tu mensaje:
BROADCAST:<mensaje>   — comunicas algo a todos los otros equipos (ej: "necesito el endpoint POST /auth/login")
PASS                  — nada que comunicar, seguir trabajando en sub-equipos`

  return [
    { role: "system", content: system },
    { role: "user", content: "Tu respuesta:" },
  ]
}
