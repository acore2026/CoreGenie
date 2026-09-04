import { useState, useEffect } from "react";
import { X, WarningCircle } from "@phosphor-icons/react";
import ScheduledJobs from "@/models/scheduledJobs";
import showToast from "@/utils/toast";
import { safeJsonParse } from "@/utils/request";
import { useTranslation } from "react-i18next";
import JobDescription from "./JobDescription";
import JobSchedule from "./JobSchedule";
import ToolsSelector from "./ToolsSelector";
import FormActions from "./FormActions";
import VisualSchedule, {
  defaultScheduleConfig,
  editableScheduleConfig,
} from "./VisualSchedule";

function setDefaultFormState(job) {
  return {
    name: job?.name || "",
    prompt: job?.prompt || "",
    schedule: job?.schedule || "0 9 * * *",
    selectedTools: Array.isArray(job?.tools)
      ? job.tools
      : job?.tools
        ? safeJsonParse(job.tools, [])
        : [],
    agentId: job?.agent_id || job?.agent?.id || "",
    scheduleConfig: editableScheduleConfig(
      job?.scheduleConfig || defaultScheduleConfig()
    ),
  };
}

export default function JobFormModal({
  job = null,
  workspaceSlug = null,
  onClose,
  onSaved,
}) {
  const { t } = useTranslation();
  const isEditing = !!job;
  const [form, setForm] = useState(setDefaultFormState(job));
  const [availableTools, setAvailableTools] = useState([]);
  const [agents, setAgents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({
    name: false,
    prompt: false,
    schedule: false,
    agentId: false,
  });
  const hasErrors = () => Object.values(errors).some(Boolean);

  const clearError = (field) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: false } : prev));
  };

  useEffect(() => {
    const loadOptions = workspaceSlug
      ? ScheduledJobs.workspace.options(workspaceSlug)
      : ScheduledJobs.availableTools();
    loadOptions.then(({ tools, agents: foundAgents = [] }) => {
      setAvailableTools(tools || []);
      setAgents(foundAgents);
      if (workspaceSlug && !form.agentId && foundAgents[0]?.id) {
        setForm((current) => ({
          ...current,
          agentId: foundAgents[0].id,
        }));
      }
    });
  }, [workspaceSlug]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    clearError(name);
  };

  const handleScheduleChange = (cron) => {
    setForm((prev) => ({ ...prev, schedule: cron }));
    clearError("schedule");
  };

  const setSelectedTools = (selectedTools) => {
    setForm((prev) => ({ ...prev, selectedTools }));
  };

  const setScheduleConfig = (scheduleConfig) => {
    setForm((prev) => ({ ...prev, scheduleConfig }));
    clearError("schedule");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nextErrors = {
      name: !form.name.trim(),
      prompt: !form.prompt.trim(),
      schedule: workspaceSlug ? !form.scheduleConfig : !form.schedule.trim(),
      agentId: workspaceSlug ? !form.agentId : false,
    };
    if (
      nextErrors.name ||
      nextErrors.prompt ||
      nextErrors.schedule ||
      nextErrors.agentId
    ) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    const data = workspaceSlug
      ? {
          name: form.name.trim(),
          prompt: form.prompt.trim(),
          agentId: Number(form.agentId),
          scheduleConfig: form.scheduleConfig,
          tools: form.selectedTools,
        }
      : {
          name: form.name.trim(),
          prompt: form.prompt.trim(),
          schedule: form.schedule.trim(),
          tools: form.selectedTools,
        };

    const result = isEditing
      ? workspaceSlug
        ? await ScheduledJobs.workspace.update(workspaceSlug, job.id, data)
        : await ScheduledJobs.update(job.id, data)
      : workspaceSlug
        ? await ScheduledJobs.workspace.create(workspaceSlug, data)
        : await ScheduledJobs.create(data);

    setSaving(false);

    if (result.error) {
      showToast(result.error, "error");
      return;
    }

    showToast(
      isEditing
        ? t("scheduledJobs.modal.jobUpdated")
        : t("scheduledJobs.modal.jobCreated"),
      "success"
    );
    onSaved();
  };

  return (
    <div className="relative max-h-[92vh] w-full max-w-2xl">
      <div className="relative max-h-[92vh] overflow-y-auto rounded-lg border border-theme-modal-border bg-theme-bg-secondary shadow">
        <div className="flex flex-col gap-1 p-4 border-b rounded-t border-theme-modal-border">
          <div className="flex items-start justify-between">
            <h3 className="text-xl font-semibold text-theme-text-primary">
              {isEditing
                ? t("scheduledJobs.modal.titleEdit")
                : t("scheduledJobs.modal.titleNew")}
            </h3>
            <button
              onClick={onClose}
              type="button"
              aria-label={t("scheduledJobs.modal.close")}
              className="ml-auto inline-flex rounded-lg border-none bg-transparent p-1.5 text-sm text-gray-400 transition-all duration-300 hover:border-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              <X className="text-gray-300 text-lg" />
            </button>
          </div>
          {hasErrors() && (
            <div className="flex gap-1 items-center">
              <WarningCircle size={16} className="text-red-400 shrink-0" />
              <p className="text-sm text-red-400">
                {t(
                  "scheduledJobs.modal.requiredFieldsBanner",
                  "Please fill out all required fields in order to create job."
                )}
              </p>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <JobDescription form={form} errors={errors} onChange={handleChange} />

          {workspaceSlug && (
            <div>
              <label className="mb-2 block text-sm font-medium text-theme-text-primary">
                {t("scheduledJobs.modal.agentLabel")}
                <span className="ml-1 text-red-400">*</span>
              </label>
              <select
                name="agentId"
                value={form.agentId}
                onChange={handleChange}
                className={`h-10 w-full rounded-lg border bg-theme-settings-input-bg px-3 text-sm text-theme-text-primary outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15 ${
                  errors.agentId
                    ? "border-red-400/60"
                    : "border-white/10 light:border-slate-300"
                }`}
              >
                <option value="">
                  {t("scheduledJobs.modal.agentPlaceholder")}
                </option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {workspaceSlug ? (
            <VisualSchedule
              value={form.scheduleConfig}
              error={errors.schedule}
              onChange={setScheduleConfig}
            />
          ) : (
            <JobSchedule
              schedule={form.schedule}
              error={errors.schedule}
              onScheduleChange={handleScheduleChange}
            />
          )}

          {availableTools.length > 0 && (
            <ToolsSelector
              availableTools={availableTools}
              selectedTools={form.selectedTools}
              onChange={setSelectedTools}
            />
          )}

          <FormActions
            isEditing={isEditing}
            saving={saving}
            onClose={onClose}
          />
        </form>
      </div>
    </div>
  );
}
