// Tiny safe markdown: headings, bullet lists, paragraphs, **bold**, `code`. Output is a plain data structure that
// React renders as text nodes, so raw HTML in the source can never execute (it is just shown as text).

export type Inline = { text: string; bold?: boolean; code?: boolean };
export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "list"; items: { depth: number; inline: Inline[] }[] };

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], code: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { depth: number; inline: Inline[] }[] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", inline: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", items: list });
    list = null;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: h[1].length as 1 | 2 | 3, inline: parseInline(h[2]) });
      continue;
    }
    const li = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      list ??= [];
      list.push({ depth: Math.min(2, Math.floor(li[1].length / 2)), inline: parseInline(li[2]) });
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}
