import { strToU8 } from "fflate";
import { parseXml, R_NS, W_NS, wordChildren } from "./ooxml";
import type { FileBytes } from "./types";

// The blank CT3 form has no numbering part. Uploaded forms may already use one.
export function addCrBulletList(entries: Record<string, FileBytes>): string {
  const relsPath = "word/_rels/document.xml.rels";
  const rels = parseXml(entries[relsPath]);
  const relationships = [...rels.documentElement.children];
  const type = R_NS + "/numbering";
  const existing = relationships.find(
    (rel) => rel.getAttribute("Type") === type
  );
  let path = "word/numbering.xml";

  const save = (part: string, doc: Document) => {
    entries[part] = strToU8(
      new XMLSerializer().serializeToString(doc)
    ) as FileBytes;
  };
  if (existing) {
    const target = existing.getAttribute("Target") || "";
    path = new URL(
      target,
      "https://package.invalid/word/document.xml"
    ).pathname.slice(1);
  } else {
    const rel = rels.createElementNS(
      rels.documentElement.namespaceURI,
      "Relationship"
    );
    let id = 1;
    while (relationships.some((r) => r.getAttribute("Id") === `rId${id}`)) id++;
    rel.setAttribute("Id", `rId${id}`);
    rel.setAttribute("Type", type);
    rel.setAttribute("Target", "numbering.xml");
    rels.documentElement.append(rel);
    save(relsPath, rels);
    const types = parseXml(entries["[Content_Types].xml"]);
    if (
      ![...types.documentElement.children].some(
        (el) => el.getAttribute("PartName") === "/" + path
      )
    ) {
      const override = types.createElementNS(
        types.documentElement.namespaceURI,
        "Override"
      );
      override.setAttribute("PartName", "/" + path);
      override.setAttribute(
        "ContentType",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"
      );
      types.documentElement.append(override);
      save("[Content_Types].xml", types);
    }
  }

  const numbering = entries[path]
    ? parseXml(entries[path], W_NS)
    : document.implementation.createDocument(W_NS, "w:numbering");
  const root = numbering.documentElement;
  const nextId = (tag: string, attr: string) =>
    String(
      1 +
        Math.max(
          0,
          ...wordChildren(root, tag).map((el) =>
            Number(el.getAttributeNS(W_NS, attr))
          )
        )
    );
  const abstractId = nextId("abstractNum", "abstractNumId");
  const numId = nextId("num", "numId");
  const definition = parseXml(
    strToU8(`<w:numbering xmlns:w="${W_NS}">
    <w:abstractNum w:abstractNumId="${abstractId}"><w:multiLevelType w:val="singleLevel"/>
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>
        <w:lvlText w:val="-"/><w:lvlJc w:val="left"/>
        <w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr>
        <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>
      </w:lvl>
    </w:abstractNum>
    <w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/></w:num>
  </w:numbering>`)
  );
  const [abstract, num] = [...definition.documentElement.children];
  const cleanup = wordChildren(root, "numIdMacAtCleanup")[0] || null;
  root.insertBefore(
    numbering.importNode(abstract, true),
    wordChildren(root, "num")[0] || cleanup
  );
  root.insertBefore(numbering.importNode(num, true), cleanup);
  save(path, numbering);
  return numId;
}
