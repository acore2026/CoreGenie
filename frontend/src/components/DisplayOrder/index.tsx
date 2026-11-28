import { useState } from "react";
import { Dialog } from "@headlessui/react";
import { ArrowUp, ArrowDown, ArrowsDownUp } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "@/utils/constants";
import { cleanHeaders } from "@/utils/api";
import { baseHeaders } from "@/utils/request";

const control =
  "dsh-control min-h-[40px] rounded-lg px-3 text-sm hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button disabled:cursor-not-allowed disabled:opacity-40";

interface OrderedItem {
  id: number | string;
  name?: string;
  title?: string;
  command?: string;
}

export default function DisplayOrder({
  items,
  kind,
  onSaved,
  disabled = false,
}: {
  items: OrderedItem[];
  kind: string;
  onSaved?: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<OrderedItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const changed = draft?.some((item, index) => item.id !== items[index]?.id);
  function move(index: number, delta: number) {
    setDraft((current) => {
      if (!current) return null;
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }
  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const endpoint =
        kind === "commands"
          ? "/system/slash-command-presets/display-order"
          : `/admin/display-order/${kind}`;
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: cleanHeaders({ ...baseHeaders() }),
        body: JSON.stringify({ ids: draft.map((item) => item.id) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || t("display_order.failed"));
      await onSaved?.();
      window.dispatchEvent(new Event("displayOrderChanged"));
      setDraft(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("display_order.failed")
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={disabled || items.length < 2}
        className={`${control} flex items-center gap-2`}
        onClick={() => {
          setError("");
          setDraft([...items]);
        }}
      >
        <ArrowsDownUp size={16} />
        {t("display_order.title")}
      </button>
      <Dialog
        open={draft !== null}
        onClose={() => !saving && setDraft(null)}
        className="fixed inset-0 z-[100]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-2xl border border-theme-chat-input-border bg-theme-bg-secondary text-theme-text-primary">
            <div className="p-5 pb-4">
              <Dialog.Title className="text-lg font-semibold">
                {t("display_order.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-theme-text-secondary">
                {t("display_order.description")}
              </Dialog.Description>
              {kind === "commands" && (
                <p className="mt-2 text-xs text-theme-text-secondary">
                  {t("display_order.reset_fixed")}
                </p>
              )}
            </div>
            <ol className="min-h-0 overflow-y-auto px-5">
              {draft?.map((item, index) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 border-t border-theme-chat-input-border py-2"
                >
                  <span className="w-5 shrink-0 text-xs tabular-nums text-theme-text-secondary">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-sm">
                    {item.name || item.title || item.command}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    {(
                      [
                        [-1, ArrowUp, "up"],
                        [1, ArrowDown, "down"],
                      ] as const
                    ).map(([delta, Icon, direction]) => (
                      <button
                        key={direction}
                        type="button"
                        className={control}
                        disabled={
                          saving ||
                          (delta < 0
                            ? index === 0
                            : index === (draft?.length ?? 0) - 1)
                        }
                        aria-label={t(`display_order.${direction}`, {
                          name: item.name || item.title || item.command,
                        })}
                        onClick={() => move(index, delta)}
                      >
                        <Icon size={16} />
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            {error && (
              <p role="alert" className="px-5 pt-3 text-sm text-red-500">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 p-5">
              <button
                type="button"
                className={control}
                disabled={saving}
                onClick={() => setDraft(null)}
              >
                {t("display_order.cancel")}
              </button>
              <button
                type="button"
                className={`${control} font-semibold`}
                disabled={saving || !changed}
                onClick={save}
              >
                {t(saving ? "display_order.saving" : "display_order.save")}
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
