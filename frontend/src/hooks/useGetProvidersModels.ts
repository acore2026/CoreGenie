import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import System from "@/models/system";
import { queryKeys } from "@/lib/queryKeys";

export const DISABLED_PROVIDERS: string[] = [];

const PROVIDER_DEFAULT_MODELS: Record<string, ProviderModel[]> = {
  openai: [],
  "generic-openai": [],
};

const GROUPED_PROVIDERS = new Set(["openai"]);

export type ProviderModel =
  | string
  | {
      id: string;
      name?: string;
      organization?: string;
      downloaded?: boolean;
      [key: string]: unknown;
    };

function groupModels(models: ProviderModel[]): Record<string, ProviderModel[]> {
  return models.reduce<Record<string, ProviderModel[]>>((acc, model) => {
    const org =
      typeof model === "object" && model?.organization
        ? model.organization
        : "other";
    acc[org] = acc[org] || [];
    acc[org].push(model);
    return acc;
  }, {});
}

export default function useGetProviderModels(provider: string | null = null): {
  defaultModels: ProviderModel[];
  customModels: ProviderModel[] | Record<string, ProviderModel[]>;
  loading: boolean;
  downloadedModels: ProviderModel[];
} {
  const { data, isPending } = useQuery<{ models?: ProviderModel[] }>({
    queryKey: queryKeys.system.providerModels(provider || ""),
    enabled: Boolean(provider),
    queryFn: () =>
      System.customModels(provider || "") as Promise<{
        models?: ProviderModel[];
      }>,
  });

  const { defaultModels, customModels, downloadedModels } = useMemo(() => {
    if (!provider || !data) {
      return {
        defaultModels: [] as ProviderModel[],
        customModels: [] as ProviderModel[],
        downloadedModels: [] as ProviderModel[],
      };
    }

    const rawModels = data.models || [];
    const nextDefault =
      Object.prototype.hasOwnProperty.call(PROVIDER_DEFAULT_MODELS, provider) &&
      !GROUPED_PROVIDERS.has(provider)
        ? PROVIDER_DEFAULT_MODELS[provider]
        : [];
    const nextCustom = GROUPED_PROVIDERS.has(provider)
      ? groupModels(rawModels)
      : rawModels;

    const flatList = Array.isArray(nextCustom)
      ? nextCustom
      : Object.values(nextCustom).flat();
    const downloaded = flatList.filter(
      (model) => typeof model === "object" && Boolean(model?.downloaded)
    );

    return {
      defaultModels: nextDefault,
      customModels: nextCustom,
      downloadedModels: downloaded,
    };
  }, [data, provider]);

  return {
    defaultModels,
    customModels,
    loading: Boolean(provider) ? isPending : true,
    downloadedModels,
  };
}
