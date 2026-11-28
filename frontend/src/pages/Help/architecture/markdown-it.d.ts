declare module "markdown-it" {
  export interface MarkdownItOptions {
    html?: boolean;
    linkify?: boolean;
    typographer?: boolean;
  }

  export interface MarkdownItToken {
    type: string;
    tag: string;
    content: string;
    attrGet(name: string): string | null;
    attrSet(name: string, value: string): void;
  }

  export type RenderRule = (
    tokens: MarkdownItToken[],
    idx: number,
    options: MarkdownItOptions,
    env: Record<string, unknown>
  ) => string;

  export interface MarkdownItRenderer {
    rules: Record<string, RenderRule | undefined>;
    render(
      tokens: MarkdownItToken[],
      options: MarkdownItOptions,
      env: Record<string, unknown>
    ): string;
  }

  export default class MarkdownIt {
    options: MarkdownItOptions;
    renderer: MarkdownItRenderer;
    constructor(options?: MarkdownItOptions);
    parse(src: string, env: Record<string, unknown>): MarkdownItToken[];
    render(src: string, env?: Record<string, unknown>): string;
  }
}
