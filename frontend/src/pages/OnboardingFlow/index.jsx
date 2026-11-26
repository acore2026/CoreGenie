import React from "react";
import OnboardingSteps, { OnboardingLayout } from "./Steps";
import { Navigate, useParams } from "react-router-dom";

export default function OnboardingFlow() {
  const { step } = useParams();
  const StepPage = OnboardingSteps[step || "home"];
  if (!StepPage) return <Navigate to="/onboarding/data-handling" replace />;
  if (step === "home" || !step) return <StepPage />;

  return (
    <OnboardingLayout>
      {(setHeader, setBackBtn, setForwardBtn) => (
        <StepPage
          setHeader={setHeader}
          setBackBtn={setBackBtn}
          setForwardBtn={setForwardBtn}
        />
      )}
    </OnboardingLayout>
  );
}
