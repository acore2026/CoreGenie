// Both bundled PDF.js versions expose this subset of the document and page APIs.
export interface PdfPage {
  pageNumber: number;
  getTextContent(): Promise<{ items: { str: string; transform: number[] }[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: [string][] }>;
  objs: {
    get(name: string): { width: number; height: number; data: Uint8Array };
  };
}
export interface PdfLibrary {
  version: string;
  OPS: {
    paintJpegXObject: number;
    paintImageXObject: number;
    paintInlineImageXObject: number;
  };
  getDocument(options: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<PdfPage>;
      getMetadata(): Promise<{
        info: { Title?: string; Creator?: string };
        metadata: unknown;
      }>;
    }>;
  };
}
export interface ParsedPage {
  pageContent: string;
  metadata: {
    source: string;
    pdf: {
      version: string;
      info?: { Title?: string; Creator?: string };
      metadata?: unknown;
      totalPages: number;
    };
    loc?: { pageNumber: number };
  };
}
