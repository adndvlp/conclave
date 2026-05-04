# 15. Effect-TS Architecture

The entire codebase is built on **Effect-TS 4.0.0-beta.57**, a functional effect system for TypeScript. This provides dependency injection, typed errors, tracing, and structured concurrency.

## Core concepts

### Context.Service

Every subsystem is a tagged service:

```typescript
export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}
```

The tag `"@opencode/Foo"` identifies the service in the dependency graph and is used for tracing/logging.

### Interface

Each service exposes a typed interface:

```typescript
export interface Interface {
  readonly method: (input: Input) => Effect.Effect<Output, Error>
}
```

### Layer

Services are constructed via `Layer.effect()`:

```typescript
export const layer = Layer.effect(Service, Effect.gen(function* () {
  const dep1 = yield* Dep1.Service
  const dep2 = yield* Dep2.Service
  return Service.of({ method: ... })
}))
```

### defaultLayer

Composes a service with all its dependencies:

```typescript
export const defaultLayer = layer.pipe(
  Layer.provide(Dep1.defaultLayer),
  Layer.provide(Dep2.defaultLayer),
)
```

## Effect composition patterns

### Effect.gen (generator-based)

```typescript
const result = yield* Effect.gen(function* () {
  const config = yield* Config.Service
  const data = yield* fetchData(config)
  return processData(data)
})
```

### Effect.fn (named/traced)

```typescript
export const runDebate = Effect.fn("Team.runDebate")(function* (...) {
  // Traced with "Team.runDebate"
})
```

### Effect.all (parallel)

```typescript
const results = yield* Effect.all(
  items.map(item => process(item)),
  { concurrency: "unbounded" }
)
```

### Effect.callback (async bridges)

```typescript
Effect.callback<Result>((resume) => {
  asyncOp().then(result => resume(Effect.succeed(result)))
})
```

## Runtime management

### makeRuntime

Creates a runtime with memoized layers:

```typescript
import { makeRuntime } from "@/effect/run-service"

const runtime = makeRuntime(MyService.defaultLayer)
const result = await runtime.runPromise(effect)
```

### InstanceState

Per-directory state with automatic cleanup:

```typescript
import { InstanceState } from "@/effect/instance-state"

const state = InstanceState.make("my-state", (dir) =>
  Effect.gen(function* () {
    // Setup that runs once per directory
    yield* Effect.addFinalizer(() => cleanup())
    return initializedState
  })
)
```

### EffectBridge

Bridges async/Promise callbacks into the Effect world:

```typescript
const bridge = yield* EffectBridge.make()

// In a callback:
bridge.fork(Effect.gen(function* () {
  yield* Bus.publish(Event, data)
}))
```

## Schema definitions

### Effect Schema

```typescript
import { Schema } from "effect"

const TeamMember = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
})

const TeamConfig = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  members: Schema.optional(Schema.Array(TeamMember)),
  maxRounds: Schema.optional(Schema.Number),
})
```

### Branded types

```typescript
const ModelID = Schema.String.pipe(Schema.brand("ModelID"))
const ProviderID = Schema.String.pipe(Schema.brand("ProviderID"))
```

## Module conventions

1. **Self-reexport pattern**: Every module ends with `export * as Foo from "./foo"` (or `"."` for index.ts)
2. **No barrel files in multi-sibling dirs**: Import directly from specific sibling (e.g., `import { SessionRetry } from "@/session/retry"`)
3. **Flat top-level exports**: No `export namespace` blocks
4. **Private helpers**: Non-exported top-level declarations

## Conclave services and layers

| Service | Tag | Key dependencies |
|---------|-----|-----------------|
| `Team.Service` | `@opencode/Team` | Provider, SessionStatus |
| `Agent.Service` | `@opencode/Agent` | Plugin, Provider, Auth, Config, Skill |
| `Provider.Service` | `@opencode/Provider` | Plugin, Config, Auth, AppFileSystem, Env |
| `LLM.Service` | `@opencode/LLM` | Auth, Config, Provider, Plugin, Permission |
| `SessionPrompt.Service` | `@opencode/SessionPrompt` | Session, Processor, Agent, LLM, Team, ... |
| `SessionProcessor.Service` | `@opencode/SessionProcessor` | Session, Agent, LLM, Permission, Plugin, ... |
| `Config.Service` | `@opencode/Config` | (multiple config sources) |
| `Permission.Service` | `@opencode/Permission` | Config, Plugin |
| `ToolRegistry.Service` | `@opencode/ToolRegistry` | Plugin, Config |
| `Bus.Service` | `@opencode/Bus` | (event bus) |
| `Plugin.Service` | `@opencode/Plugin` | Config |

## Error handling

- Use `Effect.fail()` / `yield* new MyError(...)` for expected errors
- Use `Effect.die()` / `Schema.Defect` for unexpected defects
- Use `Schema.TaggedErrorClass` for typed errors
- Use `Effect.catchTag()` for typed error recovery
- Avoid `try`/`catch` -- use Effect's error channel
