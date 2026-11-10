import { useMemo } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "@/utils/chat/purify";
import "./markdown.css";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const originalLink =
  markdown.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return originalLink(tokens, idx, options, env, self);
};

export default function AnnouncementMarkdown({ content = "" }) {
  const html = useMemo(
    () => DOMPurify.sanitize(markdown.render(content)),
    [content]
  );
  return (
    <div
      className="announcement-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
