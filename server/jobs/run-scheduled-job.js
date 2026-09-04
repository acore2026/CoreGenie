const { log, conclude } = require("./helpers/index.js");
const { safeJsonParse } = require("../utils/http");
const {
  SCHEDULED_JOB_TIMEOUT_MS,
  sendWebPushNotification,
} = require("./helpers/scheduled-job-helper.js");
const { ScheduledJob } = require("../models/scheduledJob.js");
const { ScheduledJobRun } = require("../models/scheduledJobRun.js");
const { Workspace } = require("../models/workspace.js");
const { runAgentToCompletion } = require("../agent-system/service.js");

/** Status of the scheduled job run @type {'success' | 'failed' | 'timed_out' | 'not_found' | 'killed' | undefined} */
let status;
let runId = null;

process.on("SIGTERM", async () => {
  status = "killed";
  log("Received SIGTERM, marking job as killed by user");
  if (runId) await ScheduledJobRun.kill(runId);
  conclude();
});

process.on("message", async (payload) => {
  const { jobId, runId: payloadRunId } = payload;
  runId = payloadRunId;
  let errorMessage = null;

  // The run row was created by the parent process (BackgroundService) in
  // status `queued` (it may have been waiting in p-queue). The worker
  // transitions it to `running` here so `startedAt` reflects actual execution
  // start, then runs to a terminal state. If the job has been deleted between
  // enqueue and now, fail the row.
  try {
    if (!jobId || !runId) return;

    const job = await ScheduledJob.get({ id: Number(jobId) });
    if (!job) {
      log(`Scheduled job ${jobId} not found`);
      status = "not_found";
      return;
    }

    // Transition queued -> running. If this returns false, the row was
    // already moved to a terminal state (e.g. parent failed it because it
    // thought the worker had died). Bail out without touching it further.
    const transitioned = await ScheduledJobRun.markRunning(runId);
    if (!transitioned) {
      log(
        `Scheduled job "${job.name}" (id=${job.id}) is no longer queued, skipping`
      );
      return;
    }

    log(
      `Starting scheduled job: "${job.name}" (id=${job.id}) with timeout ${SCHEDULED_JOB_TIMEOUT_MS}ms`
    );
    await ScheduledJob.markRunStarted(job.id);
    const workspace = job.workspace_id
      ? await Workspace.get({ id: job.workspace_id })
      : (await Workspace.where({}, 1, { id: "asc" }))[0];
    if (!workspace)
      throw new Error(
        "Scheduled Agent jobs require at least one workspace to provide resource scope."
      );
    const toolOverrides = safeJsonParse(job.tools, []);
    const startTime = Date.now();
    const result = await runAgentToCompletion(
      {
        workspace,
        agentId: job.agent_id,
        source: "scheduled",
        mode: "automatic",
        prompt: job.prompt,
        configuration: {
          approvalMode: "always_allow",
          toolOverrides: job.tools === null ? undefined : toolOverrides,
          persistChat: false,
          autoTitle: false,
          excludeToolIds: ["schedule.create"],
        },
      },
      { timeoutMs: SCHEDULED_JOB_TIMEOUT_MS }
    ).catch((error) => {
      if (error.message === "Agent run timed out.")
        throw new Error("SCHEDULED_JOB_TIMEOUT");
      throw error;
    });
    const duration = Date.now() - startTime;
    const thoughts = result.events
      .filter((event) => event.type === "activity.updated")
      .map((event) => event.payload.summary);
    const toolCalls = result.events
      .filter((event) => event.type === "tool.completed")
      .map((event) => ({
        toolName: event.payload.toolId,
        result: event.payload.result,
        timestamp: new Date(event.createdAt).getTime(),
      }));

    status = "success";
    await ScheduledJobRun.complete(runId, {
      result: {
        text: result.textResponse,
        thoughts,
        toolCalls,
        outputs: [],
        metrics: {},
        agentRunId: result.run.id,
        duration,
      },
    });
    log(`Scheduled job "${job.name}" completed in ${duration}ms)`);
    await sendWebPushNotification(job, runId, result.textResponse, log);
  } catch (error) {
    if (error.message === "SCHEDULED_JOB_TIMEOUT") {
      status = "timed_out";
      log("Scheduled job timed out");
    } else {
      status = "failed";
      log(`Scheduled job error: ${error.message}`);
      errorMessage = error.message;
    }
  } finally {
    switch (status) {
      case "not_found":
        await ScheduledJobRun.failIfNotTerminal(runId, "Job no longer exists");
        break;
      case "timed_out":
        await ScheduledJobRun.timeout(runId);
        break;
      case "failed":
        await ScheduledJobRun.fail(runId, { error: errorMessage });
        break;
      default: // Do nothing by default (success, killed, other)
        break;
    }

    conclude();
  }
});
