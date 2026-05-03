# Context-Aware Team Formation

## Problem

El debate actual es ciego a las capacidades de cada modelo. Todos los LLMs reciben el mismo prompt y compiten por IMPLEMENTAR, sin considerar si tienen el contexto suficiente para la tarea.

## Solución

Incluir metadata de capacidades en el system prompt del debate para que los modelos se auto-asignen roles según su perfil.

## Metadata por modelo

```ts
type ModelCapabilities = {
  name: string                    // "DeepSeek Chat"
  providerID: string              // "deepseek"
  contextWindow: number           // 1000000 (tokens)
  maxOutputTokens: number         // 8192
  reasoning: boolean              // tiene reasoning/thinking?
  speed: "fast" | "medium" | "slow"
  strengths: string[]             // ["large-context", "code-generation", "architecture"]
}
```

## System prompt actualizado

```
Eres DeepSeek Chat, parte de un equipo de AIs.

## Tus capacidades
- Contexto: 1,000,000 tokens
- Razonamiento: sí
- Velocidad: media
- Ideal para: análisis de codebases grandes, tareas de arquitectura

## Tus compañeros
- Gemini Flash: 128K tokens, rápido, ideal para prototipado y ejecución rápida
- GLM-5.1: 128K tokens, razonamiento fuerte, ideal para debugging y análisis lógico

## Reglas de auto-asignación
1. Si la tarea requiere leer TODO el codebase → solo modelos con >500K contexto
2. Si es una tarea puntual (1 archivo) → cualquiera puede tomarla
3. Modelos rápidos deberían tomar tareas de ejecución (escribir código)
4. Modelos con razonamiento deberían tomar tareas de análisis (revisar, debuggear)
5. Si tu contexto no alcanza, PROPON que otro modelo con mas contexto lo haga
```

## Implementación

En `team.ts`, después de resolver los modelos, construir el perfil de capacidades:

```ts
const profiles = participants.map(p => ({
  name: p.model.name,
  contextWindow: p.model.limit?.context ?? 128000,
  reasoning: p.model.capabilities?.reasoning ?? false,
  speed: inferSpeed(p.model),
  strengths: inferStrengths(p.model),
}))

// Pasar a buildDeliberationPrompt como teamProfiles
```

En `prompts.ts`, `buildDeliberationPrompt` ya recibe `self` y `teammates`. Solo hay que enriquecer esos objetos con las capacidades.

## Beneficios

1. Modelos con poco contexto no intentan leer codebases enteros
2. Modelos rapidos toman tareas de ejecucion, lentos de analisis
3. El equipo se auto-organiza mejor
4. Menos errores de contexto lleno
5. Las señales (LEAD, SUPPORT) son mas informadas
