import OpenAiOptions from "@/components/LLMSelection/OpenAiOptions";
import GenericOpenAiOptions from "@/components/LLMSelection/GenericOpenAiOptions";
import OpenAiLogo from "@/media/llmprovider/openai.png";
import GenericOpenAiLogo from "@/media/llmprovider/generic-openai.png";
import type { SystemKeys } from "@/models/system";
export interface LLMProvider {
  name: string;
  value: string;
  logo: string;
  description: string;
  requiredConfig: string[];
  connectionConfig?: string[];
  options: (settings: SystemKeys | null) => React.ReactNode;
}
export const LLM_PROVIDERS: LLMProvider[] = [
  {
    name: "OpenAI",
    value: "openai",
    logo: OpenAiLogo,
    options: (settings) => <OpenAiOptions settings={settings} />,
    description: "Connect directly to the OpenAI API.",
    requiredConfig: ["OpenAiKey"],
  },
  {
    name: "Generic OpenAI",
    value: "generic-openai",
    logo: GenericOpenAiLogo,
    options: (settings) => <GenericOpenAiOptions settings={settings} />,
    description: "Connect to an OpenAI-compatible chat completion API.",
    requiredConfig: ["GenericOpenAiBasePath", "GenericOpenAiModelPref"],
    connectionConfig: ["GenericOpenAiBasePath"],
  },
];
