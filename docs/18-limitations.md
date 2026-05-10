# 18. Limitations

## Latency

- **Debate overhead**: Each round requires all participants to respond in parallel. A 3-round debate with 3 models = 9 API calls before implementation starts. With 1-2s per call, that is 9-18s of debate latency.
- **Breaking Teams adds more**: Sub-team internal rounds add additional API calls. A fully decomposed task could take 30-60s before implementation begins.
- **CLI participants are slower**: Gemini CLI and Claude Code spawn subprocesses per round. Subprocess overhead adds 1-3s per call compared to direct API.

## Token cost

- **Debate cost = N * rounds * cost_per_model**: Each round, every model generates up to 1024 tokens. Over 3 rounds with 3 models, that is approximately 9K output tokens consumed.
- **Context duplication**: The full team thread is sent to every participant each round. With 3 models over 3 rounds, the system prompt + thread is sent 9 times.
- **No cost optimization**: All participants always respond. There is no early exit for models that have already converged individually.

## API dependency

- **External services required**: The debate requires live API access to all configured providers. No offline fallback.
- **Provider rate limits**: Each provider has its own rate limits. A team with models from 3 different providers must respect all 3 rate limits.
- **Provider outages**: If one model's provider is down, the debate **degrades gracefully** (v1.0.3): errored participants are skipped for that round, the `activeCount` is recalculated, and the debate can still converge. During implementation, fallback participants take over if the primary fails.
- **Model deprecation**: Providers deprecate models. A configured team may stop working when a model is removed.

## Signal protocol fragility

- **Regex-only parsing**: Signals are parsed with simple regex on the last 5 lines. If a model emits the signal in an unexpected format or puts it outside the last 5 lines, it is missed.
- **No validation of signal content**: SUPPORT claims are taken at face value. A model could SUPPORT a bad proposal with weak reasoning and still get counted.
- **Model compliance varies**: Some models are better at following the signal protocol than others. Smaller/older models may ignore signal instructions entirely.
- **Non-English models**: The signal protocol is English-only. Non-English models may struggle to follow the format.

## Breaking Teams limitations

- **Minimal cross-team communication**: BROADCAST is one-way. There is no request-response between teams (no "Frontend asks Backend for the API URL").
- **Merge conflict resolution**: v1.0.3 adds `findFileConflicts()` detection and automatic resolution by API participants when sub-teams modify the same files. However, this is best-effort -- complex semantic conflicts may not be fully merged.
- **Hard sub-team cap**: Maximum sub-teams is floor(participants.length / 2). A 4-model team can form at most 2 sub-teams.
- **Solo team limitation**: Solo teams are merged into the smallest viable team, potentially forcing a model into a role it did not choose.

## Context window pressure

- **Debate thread grows quickly**: Each response adds to the thread. After 3 rounds with 3 models, the thread can be 3-6K words.
- **Truncation heuristic is crude**: `buildThreadForModel` uses a 1-token-per-4-characters estimate. This is inaccurate for languages with different tokenization.
- **Small-context models disadvantaged**: Models with < 32K context may receive heavily truncated threads, losing important context.

## CLI bridging limitations

- **Installation dependency**: CLI tools must be pre-installed on the user's machine.
- **Version compatibility**: CLI output formats may change between versions, breaking the JSON parsing adapters.
- **No streaming during debate**: CLI participants return full responses, not streaming. The debate UI shows live reasoning from API participants via reasoning parts (v1.0.3), but CLI models still return batch output.
- **Authentication friction**: Each CLI has its own auth flow. Users must separately authenticate each CLI.

## Security considerations

- **No sandbox**: The tool can execute arbitrary shell commands, read/write any file, and access the network. The permission system is a UX guardrail, not a security boundary.
- **Server mode**: When server mode is enabled without a password, the API is unauthenticated.
- **API keys in config**: API keys stored in config files are plain text.
- **CLI subprocess trust**: CLI participants run as subprocesses with full system access (except as restricted by the CLI itself).

## Single-user design

The tool is designed for single-user, local use. There is no:
- Multi-user session management
- Role-based access control
- Audit logging
- Team collaboration features (beyond the LLM team itself)

## Experimental nature

As stated in the README: this is a research project. Features may break, APIs may change, and behavior is not guaranteed stable between versions.
