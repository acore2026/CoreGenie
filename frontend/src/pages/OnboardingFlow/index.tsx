import OnboardingHome from "./Steps/Home";
import OnboardingSteps, { OnboardingLayout } from "./Steps";
import { Navigate, useParams } from "react-router-dom";

export default function OnboardingFlow() {
  const { step } = useParams();
  if (!step || step === "home") return <OnboardingHome />;
  const StepPage = Object.hasOwn(OnboardingSteps, step)
    ? OnboardingSteps[step]
    : undefined;
  if (!StepPage) return <Navigate to="/onboarding/data-handling" replace />;

  return (
    <OnboardingLayout>{(props) => <StepPage {...props} />}</OnboardingLayout>
  );
}
