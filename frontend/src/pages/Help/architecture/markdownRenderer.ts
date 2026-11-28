import MarkdownIt from "markdown-it";
import {
  DIAGRAM_ASSETS,
  DOC_BY_SOURCE_PATH,
  type ArchitectureDoc,
  type ArchitectureDocId,
} from "./docsRegistry";

export const REPOSITORY_BASE_URL = "https://github.com/acore2026/CoreGenie";

export interface TocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface RenderedArchitectureDoc {
  html: string;
  headings: TocHeading[];
}

export type ResolvedDocLink =
  | { kind: "internal-doc"; docId: ArchitectureDocId; href: string }
  | { kind: "external"; href: string; repoPath?: string }
  | { kind: "anchor"; href: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Resolve a POSIX relative path against a repository-relative markdown file path.
 * Returns null if the path escapes above the repository root.
 */
export function resolveRepoRelativePath(
  fromFilePath: string,
  targetPath: string
): string | null {
  const baseSegments = fromFilePath.split("/").slice(0, -1);
  const targetSegments = targetPath.split("/");
  const stack = [...baseSegments];

  for (const segment of targetSegments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.join("/");
}

function isLikelyDirectory(repoPath: string): boolean {
  const clean = repoPath.replace(/\/+$/, "");
  const last = clean.split("/").at(-1) || "";
  if (repoPath.endsWith("/")) return true;
  if (!last || last.startsWith(".")) return false;
  return !last.includes(".");
}

export function resolveDocLink(
  sourcePath: string,
  rawHref: string
): ResolvedDocLink {
  const href = rawHref.trim();
  if (!href || href.startsWith("#")) {
    return { kind: "anchor", href: href || "#" };
  }
  if (/^https?:\/\//i.test(href)) {
    return { kind: "external", href };
  }

  const [pathPart, hashPart] = href.split("#");
  const resolved = resolveRepoRelativePath(sourcePath, pathPart);
  if (!resolved) {
    return { kind: "external", href };
  }

  const normalizedKey = resolved.replace(/\/+$/, "");
  const internalDoc = DOC_BY_SOURCE_PATH[normalizedKey];
  if (internalDoc) {
    const hashSuffix = hashPart ? `#${hashPart}` : "";
    return {
      kind: "internal-doc",
      docId: internalDoc.id,
      href: `/help?tab=architecture&doc=${internalDoc.id}${hashSuffix}`,
    };
  }

  const gitKind = isLikelyDirectory(pathPart) ? "tree" : "blob";
  const hashSuffix = hashPart ? `#${hashPart}` : "";
  return {
    kind: "external",
    href: `${REPOSITORY_BASE_URL}/${gitKind}/master/${normalizedKey}${hashSuffix}`,
    repoPath: normalizedKey,
  };
}

export function resolveDiagramAsset(
  sourcePath: string,
  rawSrc: string
): string {
  if (/^https?:\/\//i.test(rawSrc) || rawSrc.startsWith("data:")) {
    return rawSrc;
  }
  const resolved = resolveRepoRelativePath(sourcePath, rawSrc);
  if (resolved && DIAGRAM_ASSETS[resolved]) {
    return DIAGRAM_ASSETS[resolved];
  }
  return rawSrc;
}

function headingSlug(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  const count = seen.get(base) || 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

export function renderArchitectureMarkdown(
  doc: ArchitectureDoc
): RenderedArchitectureDoc {
  const headings: TocHeading[] = [];
  const seenSlugs = new Map<string, number>();

  const md = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  // Strip the top-level H1 from the body because the page header renders it cleanly.
  const tokens = md.parse(doc.markdown, {});
  const filteredTokens = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "heading_open" && token.tag === "h1") {
      while (
        i < tokens.length &&
        !(tokens[i].type === "heading_close" && tokens[i].tag === "h1")
      ) {
        i += 1;
      }
      continue;
    }
    if (
      token.type === "heading_open" &&
      (token.tag === "h2" || token.tag === "h3")
    ) {
      const inlineToken = tokens[i + 1];
      const text = (inlineToken?.content || "").replaceAll("`", "").trim();
      const id = headingSlug(text, seenSlugs);
      token.attrSet("id", id);
      if (text) {
        headings.push({
          id,
          text,
          level: token.tag === "h2" ? 2 : 3,
        });
      }
    }
    filteredTokens.push(token);
  }

  md.renderer.rules.table_open = () => '<div class="arch-table-wrap"><table>';
  md.renderer.rules.table_close = () => "</table></div>";

  md.renderer.rules.link_open = (renderTokens, idx) => {
    const token = renderTokens[idx];
    const rawHref = token.attrGet("href") || "";
    const resolved = resolveDocLink(doc.sourcePath, rawHref);

    if (resolved.kind === "internal-doc") {
      return `<a href="${escapeHtml(resolved.href)}" data-arch-doc="${escapeHtml(resolved.docId)}" class="arch-link arch-link-internal">`;
    }
    if (resolved.kind === "anchor") {
      return `<a href="${escapeHtml(resolved.href)}" class="arch-link">`;
    }
    const repoAttr = resolved.repoPath
      ? ` data-repo-path="${escapeHtml(resolved.repoPath)}" title="${escapeHtml(resolved.repoPath)}"`
      : "";
    return `<a href="${escapeHtml(resolved.href)}" target="_blank" rel="noreferrer noopener"${repoAttr} class="arch-link arch-link-external">`;
  };

  md.renderer.rules.image = (renderTokens, idx) => {
    const token = renderTokens[idx];
    const rawSrc = token.attrGet("src") || "";
    const alt = token.content || "";
    const src = resolveDiagramAsset(doc.sourcePath, rawSrc);
    const caption = alt
      ? `<figcaption class="arch-figure-caption">${escapeHtml(alt)}</figcaption>`
      : "";
    return `<figure class="arch-figure"><button type="button" class="arch-figure-trigger" data-diagram-src="${escapeHtml(src)}" data-diagram-alt="${escapeHtml(alt)}" aria-label="点击放大查看架构图"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" /><span class="arch-figure-zoom">点击放大</span></button>${caption}</figure>`;
  };

  const html = md.renderer.render(filteredTokens, md.options, {});
  return { html, headings };
}
