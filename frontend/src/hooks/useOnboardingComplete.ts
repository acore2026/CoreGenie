import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import System from "@/models/system";
import paths from "@/utils/paths";
import { queryKeys } from "@/lib/queryKeys";

export default function useRedirectToHomeOnOnboardingComplete(): void {
  const navigate = useNavigate();
  const { data: onboardingComplete } = useQuery<boolean>({
    queryKey: queryKeys.system.onboardingComplete,
    queryFn: () => System.isOnboardingComplete(),
  });

  useEffect(() => {
    if (onboardingComplete === true) {
      navigate(paths.home());
    }
  }, [navigate, onboardingComplete]);
}
