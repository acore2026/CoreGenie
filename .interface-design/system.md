# CoreGenie Workbench Interface

## Direction

- Feel: a calm technical workbench for supervising durable Agent work.
- Domain: plans, dependencies, specialist Agents, evidence, checkpoints, and recovery.
- Signature: one inline execution rail that expands from the current truthful status sentence into the task dependency tree and then converges into the final answer.
- Avoid: generic steppers, spinner-card stacks, blinking status, duplicate trace bubbles, and a second sidebar.

## Foundations

- Depth: borders-only; use quiet surface shifts and low-opacity borders instead of decorative shadows.
- Spacing: 4px base grid. Dense controls use 8–12px internal spacing; sections use 20–28px separation.
- Typography: Plus Jakarta Sans. Prefer weight and text tone over small size changes. Dynamic durations and counts use monospaced tabular numerals.
- Radius: 6–8px controls, 8–12px workbench panels, 16px dialogs.
- Motion: only transform and opacity, 150–200ms ease-out, and no continuous status animation.

## Color Semantics

- Base surfaces and text use existing theme tokens.
- Active work: cyan.
- Waiting or retrying: amber.
- Failure: muted red.
- Verified completion: restrained green.
- Cancelled, skipped, and metadata: graphite/slate.
- Color always accompanies an icon or label; it never carries state alone.

## Reusable Patterns

- Execution rail: 52px collapsed row; Agent identity, semantic status, current task, elapsed time, completed/total count, and disclosure control.
- Task row: 40px minimum height; state icon, task title, assigned Agent, current progress, tool/source counters, and an expandable evidence/error area.
- Live status: update one stable record by run/task ID. Never append a new bubble for progress.
- Inputs and controls: native semantic elements, 40px minimum interactive height where layout permits, visible focus rings, full light/dark contrast.
