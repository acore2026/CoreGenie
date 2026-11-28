import LiveSyncToggle from "./Features/LiveSync/toggle";

export interface Feature {
  title: string;
  component: typeof LiveSyncToggle;
  key: string;
  href?: string;
  autoEnabled?: boolean;
}
export const configurableFeatures: Record<string, Feature> = {
  experimental_live_file_sync: {
    title: "Live Document Sync",
    component: LiveSyncToggle,
    key: "experimental_live_file_sync",
  },
};
