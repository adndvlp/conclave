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
    ? `BREAK:<team>:<focus>[:<model1>,<model2>]  — propose a sub-team, optionally invite members\n` +
      `  Ex: BREAK:backend:API and auth:${input.teammates[0]?.name ?? "ModelX"}\n` +
      `  Ex: BREAK:frontend:UI and integration\n` +
      `  Available models to invite: ${teamList}\n`
    : ""

  const signalInstructions =
    input.round === 1
      ? `Round ${input.round}/${input.maxRounds} — first impression. You haven't read your teammates' responses yet.

Emit EXACTLY ONE signal at the end of your message:
PROPOSE:<your approach>   — your initial proposal
QUESTION:<doubt>          — if you need to clarify something critical before proposing
${breakSignal}PASS                     — if you have nothing to contribute`
      : `Round ${input.round}/${input.maxRounds} — you have the full team thread above.

Emit EXACTLY ONE signal at the end of your message:
LEAD:<reason>                        — take ownership, explain why you
SUPPORT:<name>:<reason>              — support someone's leadership with concrete argument
ALIGN:<name>:<reason>                — they convinced you, say why
BUILD:<what you add>                 — something new on what's already proposed
CHALLENGE:<specific point>           — concrete objection (not "needs more analysis")
SYNTHESIZE:<combine ideas of X and Y> — merge proposals into something better
EXTEND:<reason>                      — the team needs more rounds (if majority votes, add them)
PASS                                 — nothing to add`

  const system = `You are ${input.self.name}, part of a team of models solving a coding task.

Your profile:
- Provider: ${input.self.providerID}
- Context window: ${input.self.limit?.context ?? "?"}k tokens
- Capabilities: ${Object.entries(input.self.capabilities ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ")}

Full team:
${teamContext}

TASK: ${input.task}

The goal is the best solution. No ego — build on others' ideas, challenge with concrete reason.
You can assume a role if useful. The team self-organizes.

Self-assignment rules based on your context:
- If your context window is small, don't try to read the entire codebase. Delegate global analysis to a teammate with more context.
- If you're fast, focus on execution. If you have deep reasoning, focus on analysis and design.
- If your teammate has more context than you, trust their codebase analysis. Don't duplicate it.
- If the task requires deep investigation of a specific file, any model can do it.

---
${signalInstructions}`

  const messages: ModelMessage[] = [{ role: "system", content: system }]

  if (input.thread) {
    messages.push({
      role: "user",
      content: `Team thread so far:\n\n${input.thread}\n\nYour response:`,
    })
  } else {
    messages.push({ role: "user", content: "Your response:" })
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
      ? `Internal round ${input.round}/${input.maxRounds} — first round of your sub-team.

Emit EXACTLY ONE signal at the end of your message:
PROPOSE:<your approach>   — your initial proposal for this team's focus
QUESTION:<doubt>          — if you need to clarify something
PASS                      — nothing to contribute`
      : `Internal round ${input.round}/${input.maxRounds}.

Emit EXACTLY ONE signal at the end of your message:
LEAD:<reason>                        — take ownership in this sub-team
SUPPORT:<name>:<reason>              — support someone's leadership
ALIGN:<name>:<reason>                — they convinced you
BUILD:<what you add>                 — something new on what's proposed
CHALLENGE:<specific point>           — concrete objection
SYNTHESIZE:<combine ideas of X and Y> — merge proposals
EXTEND:<reason>                      — need more internal rounds
PASS                                 — nothing to add`

  const system = `You are ${input.self.name}, part of sub-team "${input.teamName}".

YOUR TEAM'S FOCUS: ${input.focus}

Your sub-team:
${teammateContext ? `${input.self.name} (you)\n${teammateContext}` : `${input.self.name} (you — only member)`}
${crossTeamSection}
GLOBAL TASK: ${input.task}

Work exclusively on your sub-team's focus. Other teams handle the rest.

---
${signalInstructions}`

  const messages: ModelMessage[] = [{ role: "system", content: system }]

  if (input.thread) {
    messages.push({
      role: "user",
      content: `Your sub-team thread:\n\n${input.thread}\n\nYour response:`,
    })
  } else {
    messages.push({ role: "user", content: "Your response:" })
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

  const system = `You are ${input.self.name}, global coordination round between sub-teams.

TASK: ${input.task}

This is a coordination round. Sub-teams have completed their internal cycles.
Here's the progress summary of each team so you can coordinate.

Your sub-team (${input.myTeamName}):
${input.myTeamSummary}

Other teams:
${otherTeamsSection}

---
Global round ${input.globalRound}.

If you need to communicate something to other teams (questions, dependencies, blockers), use BROADCAST.
If you have nothing to communicate and your team can continue working, use PASS.

Emit EXACTLY ONE signal at the end of your message:
BROADCAST:<message>   — communicate something to all other teams (e.g., "I need the endpoint POST /auth/login")
PASS                  — nothing to communicate, continue working in sub-teams`

  return [
    { role: "system", content: system },
    { role: "user", content: "Your response:" },
  ]
}
