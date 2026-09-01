# CoreGenie live Agent evaluations

Promptfoo calls the same Agent runtime used by the workspace UI through API-key-authenticated `/api/v1` endpoints. Promptfoo stores the evaluation matrix and manual ratings; Langfuse stores the correlated execution trace. The trace ID is included in every provider result.

The first bootstrap contains ten runtime and 3GPP cases. Each manual suite run uses one concurrent case, disables the response cache, and repeats every case three times. All hard and semantic assertions must pass on all attempts.

## Operations

Start or update the deployed services from the repository root:

```bash
APP_REBUILD=true APP_RECREATE=true PROMPTFOO_REBUILD=true PROMPTFOO_RECREATE=true ./start-anythingllm.sh
```

The Promptfoo UI is available on port `7391`. It intentionally has no authentication. Anyone who can reach that port can view evaluation data and trigger model/API usage.

Run checks from the host:

```bash
evals/agent/bin/promptfoo-admin.sh smoke
evals/agent/bin/promptfoo-admin.sh run
evals/agent/bin/promptfoo-admin.sh cleanup
evals/agent/bin/promptfoo-admin.sh backup
```

`promptfooconfig.bootstrap.yaml` is only the initial import. After the first run, use Promptfoo's UI to edit, duplicate, rate, compare, and rerun cases. The persistent Promptfoo database under `/root/anythingllm/promptfoo` is the operational source of truth.

The default semantic judge is the current OpenAI-compatible production model. Change `defaultTest.options.provider` in Promptfoo when another configured judge should be used. Do not select the CoreGenie Agent provider as the judge because that starts another Agent workflow instead of a direct model call.
