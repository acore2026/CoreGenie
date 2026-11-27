import System from "@/models/system";
import { useEffect, useState } from "react";

// Providers which cannot use this feature for workspace<>model selection
export const DISABLED_PROVIDERS = [];
const PROVIDER_DEFAULT_MODELS = {
  openai: [],
  "generic-openai": [],
};

function groupModels(models) {
  return models.reduce((acc, model) => {
    acc[model.organization] = acc[model.organization] || [];
    acc[model.organization].push(model);
    return acc;
  }, {});
}

const groupedProviders = ["openai"];
/** @typedef {string | { id:string, name?:string, downloaded?:boolean }} ProviderModel */
/** @param {string | null} provider
 * @returns {{defaultModels:ProviderModel[], customModels:ProviderModel[] | Record<string,ProviderModel[]>, loading:boolean, downloadedModels:ProviderModel[]}}
 */
export default function useGetProviderModels(provider = null) {
  const [defaultModels, setDefaultModels] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const downloadedModels = [];

  if (Array.isArray(customModels)) {
    downloadedModels.push(...customModels.filter((model) => model?.downloaded));
  } else {
    // Break out downloaded models from the creator map
    downloadedModels.push(
      ...Object.values(customModels)
        .flat()
        .filter((model) => model?.downloaded)
    );
  }

  useEffect(() => {
    async function fetchProviderModels() {
      if (!provider) return;
      setLoading(true);
      const { models = [] } = await System.customModels(provider);
      if (
        PROVIDER_DEFAULT_MODELS.hasOwnProperty(provider) &&
        !groupedProviders.includes(provider)
      ) {
        setDefaultModels(PROVIDER_DEFAULT_MODELS[provider]);
      } else {
        setDefaultModels([]);
      }

      groupedProviders.includes(provider)
        ? setCustomModels(groupModels(models))
        : setCustomModels(models);
      setLoading(false);
    }
    fetchProviderModels();
  }, [provider]);

  return { defaultModels, customModels, loading, downloadedModels };
}
