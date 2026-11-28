import { useEffect, useState } from "react";
import System from "@/models/system";

export default function useProviderEndpointAutoDiscovery({
  provider,
  initialBasePath = "",
  initialAuthToken = null,
  ENDPOINTS = [],
}: {
  provider: string;
  initialBasePath?: string;
  initialAuthToken?: string | null;
  ENDPOINTS?: string[];
}) {
  const [loading, setLoading] = useState(false);
  const [basePath, setBasePath] = useState(initialBasePath);
  const [basePathValue, setBasePathValue] = useState(initialBasePath);

  const [authToken, setAuthToken] = useState(initialAuthToken);
  const [authTokenValue, setAuthTokenValue] = useState(initialAuthToken);
  const [autoDetectAttempted, setAutoDetectAttempted] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(true);

  async function autoDetect() {
    setLoading(true);
    setAutoDetectAttempted(true);
    try {
      const endpoint = await Promise.any(
        ENDPOINTS.map(async (candidate) => {
          const result = await System.customModels(
            provider,
            authTokenValue,
            candidate,
            2_000
          );
          if (!result?.models?.length) throw new Error("No models");
          return candidate;
        })
      );
      setBasePath(endpoint);
      setBasePathValue(endpoint);
      setShowAdvancedControls(false);
    } catch {
      setShowAdvancedControls(true);
    } finally {
      setLoading(false);
    }
  }

  function handleAutoDetectClick(e: React.MouseEvent) {
    e.preventDefault();
    autoDetect();
  }

  function handleBasePathChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setBasePathValue(value);
  }

  function handleBasePathBlur() {
    setBasePath(basePathValue);
  }

  function handleAuthTokenChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setAuthTokenValue(value);
  }

  function handleAuthTokenBlur() {
    setAuthToken(authTokenValue);
  }

  useEffect(() => {
    if (!initialBasePath && !autoDetectAttempted) autoDetect();
  }, [initialBasePath, initialAuthToken, autoDetectAttempted]);

  return {
    autoDetecting: loading,
    autoDetectAttempted,
    showAdvancedControls,
    setShowAdvancedControls,
    basePath: {
      value: basePath,
      set: setBasePathValue,
      onChange: handleBasePathChange,
      onBlur: handleBasePathBlur,
    },
    basePathValue: {
      value: basePathValue,
      set: setBasePathValue,
    },
    authToken: {
      value: authToken,
      set: setAuthTokenValue,
      onChange: handleAuthTokenChange,
      onBlur: handleAuthTokenBlur,
    },
    authTokenValue: {
      value: authTokenValue,
      set: setAuthTokenValue,
    },
    handleAutoDetectClick,
    runAutoDetect: autoDetect,
  };
}
