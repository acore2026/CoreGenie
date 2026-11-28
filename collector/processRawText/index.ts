import type { DocumentMetadata } from "../types.js";
import { randomUUID as v4 } from "node:crypto";
import { writeToServerDocuments } from "../utils/files/index.js";
import { tokenizeString } from "../utils/tokenizer/index.js";
import slugify from "slugify";

// Will remove the last .extension from the input
// and stringify the input + move to lowercase.
function stripAndSlug(input = "Unknown-doc") {
  if (!input.includes(".")) return slugify(input, { lower: true });
  return slugify(input.split(".").slice(0, -1).join("-"), { lower: true });
}

const METADATA_KEYS = {
  possible: {
    url: ({ url, title }: DocumentMetadata) => {
      let validUrl;
      try {
        const u = new URL(url ?? "");
        validUrl = ["https:", "http:"].includes(u.protocol);
      } catch {}

      if (url && validUrl) return `web://${url.toLowerCase()}.website`;
      return `file://${stripAndSlug(title)}.txt`;
    },
    title: ({ title }: DocumentMetadata) => `${stripAndSlug(title)}.txt`,
    docAuthor: ({ docAuthor }: DocumentMetadata) => {
      return typeof docAuthor === "string" ? docAuthor : "no author specified";
    },
    description: ({ description }: DocumentMetadata) => {
      return typeof description === "string"
        ? description
        : "no description found";
    },
    docSource: ({ docSource }: DocumentMetadata) => {
      return typeof docSource === "string" ? docSource : "no source set";
    },
    chunkSource: ({ chunkSource, title }: DocumentMetadata) => {
      return typeof chunkSource === "string"
        ? chunkSource
        : `${stripAndSlug(title)}.txt`;
    },
    published: ({ published }: DocumentMetadata) => {
      if (isNaN(Number(published))) return new Date().toLocaleString();
      return new Date(Number(published)).toLocaleString();
    },
  },
};

async function processRawText(textContent: string, metadata: DocumentMetadata) {
  console.log(`-- Working Raw Text doc ${metadata.title} --`);
  if (!textContent || textContent.length === 0) {
    return {
      success: false,
      reason: "textContent was empty - nothing to process.",
      documents: [],
    };
  }

  const data = {
    id: v4(),
    url: METADATA_KEYS.possible.url(metadata),
    title: METADATA_KEYS.possible.title(metadata),
    docAuthor: METADATA_KEYS.possible.docAuthor(metadata),
    description: METADATA_KEYS.possible.description(metadata),
    docSource: METADATA_KEYS.possible.docSource(metadata),
    chunkSource: METADATA_KEYS.possible.chunkSource(metadata),
    published: METADATA_KEYS.possible.published(metadata),
    wordCount: textContent.split(" ").length,
    pageContent: textContent,
    token_count_estimate: tokenizeString(textContent),
  };

  const document = writeToServerDocuments({
    data,
    filename: `raw-${stripAndSlug(metadata.title)}-${data.id}`,
  });
  console.log(
    `[SUCCESS]: Raw text and metadata saved & ready for embedding.\n`
  );
  return { success: true, reason: null, documents: [document] };
}

export { processRawText };
