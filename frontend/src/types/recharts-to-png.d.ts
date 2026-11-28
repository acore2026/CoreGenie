import type { UseGenerateImage, UseGenerateImageArgs } from "recharts-to-png";

declare module "recharts-to-png" {
  // The library passes these overrides to html2canvas, which supplies the defaults.
  export function useGenerateImage<T extends HTMLElement = HTMLDivElement>(
    args: Omit<UseGenerateImageArgs, "options"> & {
      options: Partial<NonNullable<UseGenerateImageArgs["options"]>>;
    }
  ): UseGenerateImage<T>;
}
