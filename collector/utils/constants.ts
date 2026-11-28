import type { FileConverter } from "../types.js";
import path from "node:path";
import { collectorRoot } from "../paths.js";
const WATCH_DIRECTORY = path.join(collectorRoot, "hotdir");

const ACCEPTED_MIMES: Record<string, string[]> = {
  "text/plain": [".txt", ".md", ".org", ".adoc", ".rst"],
  "text/html": [".html"],
  "text/csv": [".csv"],
  "application/json": [".json"],
  // TODO: Create asDoc.js that works for standard MS Word files.
  // "application/msword": [".doc"],

  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    ".pptx",
  ],

  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],

  "application/vnd.oasis.opendocument.text": [".odt"],
  "application/vnd.oasis.opendocument.presentation": [".odp"],

  "application/pdf": [".pdf"],
  "application/mbox": [".mbox"],

  "application/epub+zip": [".epub"],
  "image/png": [".png"],
  "image/jpeg": [".jpg"],
  "image/jpg": [".jpg"],
  "image/webp": [".webp"],
};

const SUPPORTED_FILETYPE_CONVERTERS: Record<
  string,
  () => Promise<{ default: FileConverter }>
> = {
  ".txt": () => import("../processSingleFile/convert/asTxt.js"),
  ".md": () => import("../processSingleFile/convert/asTxt.js"),
  ".org": () => import("../processSingleFile/convert/asTxt.js"),
  ".adoc": () => import("../processSingleFile/convert/asTxt.js"),
  ".rst": () => import("../processSingleFile/convert/asTxt.js"),
  ".csv": () => import("../processSingleFile/convert/asTxt.js"),
  ".json": () => import("../processSingleFile/convert/asTxt.js"),

  ".html": () => import("../processSingleFile/convert/asTxt.js"),
  ".pdf": () => import("../processSingleFile/convert/asPDF/index.js"),

  ".docx": () => import("../processSingleFile/convert/asDocx.js"),
  // TODO: Create asDoc.js that works for standard MS Word files.
  // ".doc": "./convert/asDoc.js",

  ".pptx": () => import("../processSingleFile/convert/asOfficeMime.js"),

  ".odt": () => import("../processSingleFile/convert/asOfficeMime.js"),
  ".odp": () => import("../processSingleFile/convert/asOfficeMime.js"),

  ".xlsx": () => import("../processSingleFile/convert/asXlsx.js"),

  ".mbox": () => import("../processSingleFile/convert/asMbox.js"),

  ".epub": () => import("../processSingleFile/convert/asEPub.js"),

  ".png": () => import("../processSingleFile/convert/asImage.js"),
  ".jpg": () => import("../processSingleFile/convert/asImage.js"),
  ".jpeg": () => import("../processSingleFile/convert/asImage.js"),
  ".webp": () => import("../processSingleFile/convert/asImage.js"),
};

export { SUPPORTED_FILETYPE_CONVERTERS, WATCH_DIRECTORY, ACCEPTED_MIMES };
