declare module "uuid" {
  export function v4(): string;
}

declare module "file-saver" {
  export function saveAs(data: Blob | string, filename?: string): void;
}

declare module "lodash.debounce" {
  export default function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait?: number
  ): T & { cancel: () => void; flush: () => void };
}
