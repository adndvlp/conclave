import { Schema } from "effect"

export const TeamMember = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
})
export type TeamMember = Schema.Schema.Type<typeof TeamMember>

export const BreakingTeamsConfig = Schema.Struct({
  maxSubTeams: Schema.optional(Schema.Number),
  globalRoundInterval: Schema.optional(Schema.Number),
})
export type BreakingTeamsConfig = Schema.Schema.Type<typeof BreakingTeamsConfig>

export const TeamConfig = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  members: Schema.optional(Schema.mutable(Schema.Array(TeamMember))),
  maxRounds: Schema.optional(Schema.Number),
  minRounds: Schema.optional(Schema.Number),
  maxExtensions: Schema.optional(Schema.Number),
  roundExtension: Schema.optional(Schema.Number),
  breakingTeams: Schema.optional(BreakingTeamsConfig),
})
export type TeamConfig = Schema.Schema.Type<typeof TeamConfig>

export type SubTeamStatus = "working" | "done" | "blocked"

export type SubTeam = {
  id: string
  name: string
  focus: string
  memberIDs: string[]
  thread: string
  rounds: number
  status: SubTeamStatus
  crossTeamMessages: CrossTeamMessage[]
}

export type CrossTeamMessage = {
  fromTeam: string
  message: string
  globalRound: number
}
