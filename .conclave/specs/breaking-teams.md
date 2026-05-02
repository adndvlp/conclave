# Breaking Teams — Multi-Team Parallel Debate

## Vision

Permitir que un equipo de LLMs se divida dinamicamente en sub-equipos para trabajar tareas complejas en paralelo, con comunicacion entre equipos y edicion simultanea sin conflictos.

## Flujo General

```
┌─────────────────────────────────────────────────────────────┐
│  Usuario (Project Manager)                                   │
│  "Implementa sistema de autenticacion completo"              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Ronda 0: Análisis & Planificación                          │
│  - Cada LLM lee el codebase                                 │
│  - Identifican componentes: frontend, backend, auth, db     │
│  - Votan si se necesitan sub-equipos (breaking teams)       │
│  - Si hay consenso → proponen division                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Ronda 1: Formación de Sub-Equipos                          │
│  - Según benchmarks, cada LLM se autoasigna a un equipo     │
│    · Lógica/razonamiento → Backend                          │
│    · UX/UI, creatividad → Frontend                          │
│    · Seguridad, infra → Auth/DB                             │
│  - Se establecen líderes por sub-equipo                     │
│  - Se definen contratos entre equipos (APIs, tipos, etc.)   │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Sub-Equipo A │ │ Sub-Equipo B │ │ Sub-Equipo C │
│ (Frontend)   │ │ (Backend)    │ │ (Auth/DB)    │
│ 2-3 LLMs     │ │ 2-3 LLMs     │ │ 2-3 LLMs     │
│              │ │              │ │              │
│ Trabajan en  │ │ Trabajan en  │ │ Trabajan en  │
│ paralelo     │ │ paralelo     │ │ paralelo     │
│              │ │              │ │              │
│ Rondas       │ │ Rondas       │ │ Rondas       │
│ internas     │ │ internas     │ │ internas     │
│ cada equipo  │ │ cada equipo  │ │ cada equipo  │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Ronda N: Meta-Coordinación                                 │
│  - Equipos comparten su progreso                            │
│  - Responden preguntas del otro equipo                      │
│    · Frontend pregunta: "¿URL del endpoint?"               │
│    · Backend responde: "POST /api/auth/login"              │
│  - Se actualizan contratos si es necesario                  │
│  - Se decide si continuar otra ronda o finalizar            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Ronda Final: Merge & Review                                │
│  - Todos los cambios se integran                            │
│  - El equipo completo revisa el resultado                   │
│  - Se decide si se necesita refinamiento adicional          │
└─────────────────────────────────────────────────────────────┘
```

## Arquitectura Técnica

### Estructura de Datos

```ts
type BreakingTeamConfig = {
  enabled: boolean                          // Toggle en el frontend
  maxSubTeams: number                       // Maximo sub-equipos permitidos
  minMembersPerTeam: number                 // Minimo miembros por sub-equipo (default: 2)
  strategy: "auto" | "manual"               // Auto: LLMs deciden, Manual: usuario define
}

type SubTeam = {
  id: string
  name: string                              // "Frontend", "Backend", etc.
  focus: string                             // Descripcion de la tarea del sub-equipo
  members: Participant[]                    // LLMs asignados
  contracts: TeamContract[]                 // Contratos con otros equipos
  rounds: number                            // Rondas completadas
  status: "working" | "done" | "blocked"    // Estado actual
  artifacts: string[]                       // Archivos modificados
}

type TeamContract = {
  fromTeamID: string                        // Quien ofrece/necesita
  toTeamID: string                          // Quien consume/provee
  type: "api_spec" | "type_def" | "interface" | "schema" | "question"
  question?: string                         // Si es pregunta: el texto
  answer?: string                           // Si fue respondida
  content: string                           // El contrato en si (TS types, JSON schema, etc.)
  status: "pending" | "answered" | "accepted"
}
```

### Sesiones Paralelas

Cada sub-equipo corre en su propia "sesion" con su propio `runDebate()`:

```ts
const runBreakingTeams = Effect.fn("Team.runBreakingTeams")(function* (
  participants: Participant[],
  task: string,
  maxRounds: number,
  onProgress: ProgressCallback,
) {
  // Ronda 0: Analisis y decision de division
  const analysis = yield* analyzeTask(participants, task)

  if (!analysis.shouldBreak) {
    // No se necesitan sub-equipos → debate normal
    return yield* runDebate(participants, task, maxRounds, onProgress)
  }

  // Formar sub-equipos segun afinidad/bencmarks
  const subTeams = yield* formSubTeams(participants, analysis.taskBreakdown)

  // Ejecutar sub-equipos en paralelo
  const subTeamResults = yield* Effect.all(
    subTeams.map((team) =>
      runDebate(team.members, team.focus, maxRounds, (round, total, signals) =>
        onProgress(round, total, signals, team.id),
      ),
    ),
    { concurrency: "unbounded" },
  )

  // Meta-ronda: comunicacion entre equipos
  const contracts = yield* crossTeamCommunication(subTeams, subTeamResults)

  // Si hay preguntas pendientes, repetir meta-ronda
  // ...

  // Ronda final: merge y revision
  return yield* finalReview(participants, subTeamResults, contracts)
})
```

### Comunicacion Entre Equipos

```ts
function crossTeamCommunication(
  teams: SubTeam[],
  results: DebateResult[],
): Effect.Effect<TeamContract[]> {
  return Effect.gen(function* () {
    // Cada equipo revisa el trabajo de los otros
    // y plantea preguntas o requerimientos
    const allContracts: TeamContract[] = []

    for (const team of teams) {
      const otherTeams = teams.filter((t) => t.id !== team.id)

      for (const other of otherTeams) {
        // El equipo pregunta al otro
        const questions = yield* askTeam(team, other, results)

        // El otro responde
        const answers = yield* answerTeam(other, team, questions, results)

        allContracts.push(...answers)
      }
    }

    return allContracts
  })
}
```

### Edicion Simultanea Sin Conflictos

Cada LLM dentro de un sub-equipo puede editar archivos al mismo tiempo porque:

1. **Comunicacion previa**: Antes de editar, los LLMs del sub-equipo acuerdan que archivos tocara cada uno (señal `IMPLEMENT:archivoX.ts`)

2. **File locking via signals**: El debate interno produce un "plan de edicion" donde cada LLM declara sus archivos:
   ```
   [claude]: IMPLEMENT:src/auth/login.ts, src/auth/types.ts
   [gemini]: IMPLEMENT:src/auth/middleware.ts, src/auth/db.ts
   ```

3. **No-conflict guarantee**: El sistema verifica que no haya overlap antes de aplicar cambios

4. **Merge automatico**: Al final de cada ronda de sub-equipo, se aplican todos los cambios (que no se solapan)

### Toggle en el Frontend (TUI + Web)

```tsx
// En el dialogo de team, agregar opcion de breaking teams
<Show when={teamMembers.length >= 4}>
  <Toggle
    label="Breaking Teams"
    description="Permitir que el equipo se divida en sub-equipos"
    checked={breakingTeamsEnabled()}
    onChange={toggleBreakingTeams}
  />
  <Show when={breakingTeamsEnabled()}>
    <Select
      label="Max sub-equipos"
      options={[2, 3, 4]}
      value={maxSubTeams()}
    />
  </Show>
</Show>
```

## Roadmap de Implementacion

### Fase 1: Fundacion (Actual)
- [x] Team basico (seleccion de modelos)
- [x] Debate multi-LLM con rondas
- [x] Señales: IMPLEMENT, DELEGATE, AGREE, REFINE
- [x] Comando `/team` en TUI y web
- [ ] Persistencia de team (guardar en config)

### Fase 2: Breaking Teams — Core
- [ ] Schema de `SubTeam` y `TeamContract`
- [ ] Logica de `analyzeTask()` para decidir si dividir
- [ ] `formSubTeams()` con asignacion por benchmarks
- [ ] `runBreakingTeams()` — ejecucion paralela de sub-equipos
- [ ] Toggle "Breaking Teams" en frontend

### Fase 3: Comunicacion Cross-Team
- [ ] `crossTeamCommunication()` — preguntas/respuestas entre equipos
- [ ] Contratos (`TeamContract`) para APIs, tipos, schemas
- [ ] Meta-rondas de coordinacion

### Fase 4: Edicion Simultanea
- [ ] Plan de edicion por LLM (que archivos toca cada uno)
- [ ] Verificacion de no-conflicto
- [ ] Aplicacion paralela de cambios
- [ ] Merge automatico post-ronda

### Fase 5: UX Avanzada
- [ ] Visualizacion de sub-equipos en TUI/web
- [ ] Progreso en tiempo real por sub-equipo (WebSocket/SSE)
- [ ] Intervencion manual del PM (reasignar, cancelar sub-equipo)
- [ ] Historial de decisiones de division

## Notas de Diseño

### Por que WebSocket/SSE para progreso en tiempo real

Actualmente el progreso del debate se comunica via `SessionStatus`. Para breaking teams necesitamos:

```ts
type BreakingTeamStatus = {
  type: "team.breaking"
  subTeams: {
    id: string
    name: string
    status: "analyzing" | "debating" | "done" | "blocked"
    round: number
    total: number
    signals: RoundSignal[]
    members: string[]
  }[]
  crossTeamRound: number
  contracts: TeamContract[]
}
```

### Benchmarks para asignacion automatica

Cada modelo tiene capacidades conocidas. Se puede usar el provider/model ID para inferir afinidad:

```
Claude Opus → Backend, razonamiento complejo
Claude Sonnet → Frontend, rapido
Gemini Pro → Infraestructura, seguridad
GPT-4o → Full-stack, balanceado
```

En el futuro se puede usar un sistema de "etiquetas" declaradas por el proveedor o por el usuario.

### Decision de Division

Los LLMs emiten una nueva señal: `BREAK:<team_name>:<focus>`

```
[claude-opus]: BREAK:backend:API de autenticación y lógica de tokens
[claude-sonnet]: BREAK:frontend:Formularios de login/registro y estado
[gemini]: AGREE:claude-opus
```

Si 2+ LLMs proponen `BREAK` con focos diferentes y no hay `REFINE` en contra, se procede a dividir.
