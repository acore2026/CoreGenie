import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type {
  ProposalItem,
  ProposalPlan,
  PlanFailure,
} from "@/utils/localTools/types";
import { control, input } from "./proposalControls";

interface Props {
  item: ProposalItem;
  plan: ProposalPlan | PlanFailure | null;
  duplicate: boolean;
  locked: boolean;
  hasRecords: boolean;
  onChange: (changes: Partial<ProposalItem>) => void;
  onRemove: () => void;
}

export default function ProposalMatch({
  item,
  plan,
  duplicate,
  locked,
  hasRecords,
  onChange,
  onRemove,
}: Props) {
  const { t: tr } = useTranslation(undefined, { keyPrefix: "local_tools" });
  return (
    <article
      className={`min-w-0 rounded-xl border border-theme-sidebar-border p-4 md:p-5 ${item.excluded ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-all text-sm font-semibold">{item.file.name}</h3>
          {item.proposal && (
            <>
              <p className="mt-2 break-words text-sm">
                {item.proposal.metadata.title}
              </p>
              <p className="mt-1 text-xs text-theme-text-secondary">
                {item.proposal.metadata.spec} · {item.proposal.metadata.release}{" "}
                · {item.proposal.metadata.source}
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          className={control}
          disabled={locked}
          aria-label={tr("remove_file", { name: item.file.name })}
          onClick={onRemove}
        >
          <X size={16} />
        </button>
      </div>
      {item.error ? (
        <p className="mt-3 text-sm text-red-500" role="alert">
          {item.error}
        </p>
      ) : (
        <>
          <label className="mt-4 block text-sm">
            {tr("matching_record")}
            <select
              className={`${input} mt-2`}
              value={item.selectedId}
              disabled={locked || item.excluded || !hasRecords}
              onChange={(e) =>
                onChange({
                  selectedId: e.target.value,
                  confirmed: false,
                  exportError: "",
                })
              }
            >
              <option value="">
                {tr(
                  !hasRecords
                    ? "choose_meeting_first"
                    : item.reason || "choose_record"
                )}
              </option>
              {item.candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.tdoc} · {r.spec} · {r.release} · {r.source} ·{" "}
                  {r.sourceFile} · {tr("row", { row: r.row })}
                </option>
              ))}
            </select>
          </label>
          {plan?.error && (
            <p role="alert" className="mt-3 text-sm text-red-500">
              {plan.error}
            </p>
          )}
          {plan?.changes && (
            <>
              <p className="mt-3 break-all text-xs text-theme-text-secondary">
                {tr("record_source", {
                  name: plan.record.sourceFile,
                  row: plan.record.row,
                })}
              </p>
              <div className="mt-4 divide-y divide-theme-sidebar-border rounded-lg border border-theme-sidebar-border md:hidden">
                {plan.changes.map((change) => (
                  <div key={change.field} className="p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                      <p>{tr(`fields.${change.field}`)}</p>
                      <span className="text-theme-text-secondary">
                        {tr(
                          change.conflict
                            ? "conflict"
                            : change.changed
                              ? "fill"
                              : "unchanged"
                        )}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                      {(["before", "after"] as const).map((key) => (
                        <div key={key} className="min-w-0">
                          <dt className="text-xs text-theme-text-secondary">
                            {tr(key)}
                          </dt>
                          <dd className="mt-1 break-all font-mono">
                            {change[key] || tr("blank")}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
              <div className="mt-4 hidden overflow-x-auto rounded-lg border border-theme-sidebar-border md:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-theme-sidebar-item-hover">
                    <tr>
                      {["field", "before", "after", "state"].map((key) => (
                        <th key={key} className="px-3 py-2 font-medium">
                          {tr(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.changes.map((c) => (
                      <tr
                        key={c.field}
                        className="border-t border-theme-sidebar-border"
                      >
                        <td className="whitespace-nowrap px-3 py-2">
                          {tr(`fields.${c.field}`)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono">
                          {c.before || tr("blank")}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono">
                          {c.after || tr("blank")}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {tr(
                            c.conflict
                              ? "conflict"
                              : c.changed
                                ? "fill"
                                : "unchanged"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {plan.metadataConflicts.map((key) => (
                <p key={key} className="mt-2 text-sm text-amber-600">
                  {tr("metadata_difference", {
                    field: tr(`fields.${key}`),
                    before: item.proposal?.metadata[key],
                    after: plan.record[key],
                  })}
                </p>
              ))}
              {plan.conflicts > 0 && (
                <label className="mt-3 flex items-start gap-2 text-sm leading-6">
                  <input
                    type="checkbox"
                    className="mt-1.5 h-4 w-4 shrink-0 accent-cyan-600"
                    checked={item.confirmed}
                    disabled={locked || item.excluded}
                    onChange={(e) =>
                      onChange({
                        confirmed: e.target.checked,
                        exportError: "",
                      })
                    }
                  />
                  {tr("confirm_conflicts")}
                </label>
              )}
              <p className="mt-3 break-all text-sm">
                {tr("output_name", { name: plan.outputName })}
              </p>
              {duplicate && (
                <p role="alert" className="mt-2 text-sm text-red-500">
                  {tr("errors.duplicate")}
                </p>
              )}
            </>
          )}
          <label className="mt-3 flex items-center gap-2 text-sm text-theme-text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-cyan-600"
              checked={item.excluded}
              disabled={locked}
              onChange={(e) =>
                onChange({
                  excluded: e.target.checked,
                })
              }
            />
            {tr("exclude")}
          </label>
          {item.exportError && (
            <p role="alert" className="mt-2 text-sm text-red-500">
              {item.exportError}
            </p>
          )}
        </>
      )}
    </article>
  );
}
