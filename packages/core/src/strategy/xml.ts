/**
 * Minimal XML reader for Blockly documents.
 *
 * Deliberately hand-rolled rather than pulling in a parser dependency, because
 * these files are uploaded by users and the classic XML attacks are all things
 * a general parser supports and we simply don't need:
 *
 *   - `<!DOCTYPE>` / `<!ENTITY>` are rejected outright, which makes XXE and
 *     billion-laughs entity expansion impossible rather than merely configured
 *     off.
 *   - No external references of any kind are resolved.
 *   - Nesting depth and node count are capped, so a hostile file can't exhaust
 *     memory or blow the stack.
 *
 * It is not a general XML parser and shouldn't be used as one. Blockly output
 * is machine-generated and regular: elements, attributes, text.
 */

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const MAX_DEPTH = 200;
const MAX_NODES = 200_000;

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      // Only real scalar values; anything else stays literal.
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

export function parseXml(src: string): XmlNode {
  if (/<!DOCTYPE/i.test(src) || /<!ENTITY/i.test(src)) {
    throw new XmlError("This file declares a DOCTYPE or ENTITY, which isn't allowed.");
  }

  const root: XmlNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let nodes = 0;
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;

    // Text between elements.
    if (lt > i) {
      const text = decode(src.slice(i, lt)).trim();
      if (text) stack[stack.length - 1].text += text;
    }

    // Comments, CDATA and processing instructions carry nothing we need.
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt);
      if (end === -1) throw new XmlError("Unterminated comment.");
      i = end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt);
      if (end === -1) throw new XmlError("Unterminated CDATA.");
      stack[stack.length - 1].text += src.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt);
      if (end === -1) throw new XmlError("Unterminated processing instruction.");
      i = end + 2;
      continue;
    }

    const gt = src.indexOf(">", lt);
    if (gt === -1) throw new XmlError("Unterminated tag.");
    const raw = src.slice(lt + 1, gt).trim();

    // Closing tag.
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      const top = stack[stack.length - 1];
      if (stack.length === 1) throw new XmlError(`Unexpected closing tag </${name}>.`);
      if (top.tag !== name) {
        throw new XmlError(`Mismatched tag: expected </${top.tag}>, found </${name}>.`);
      }
      stack.pop();
      i = gt + 1;
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const spaceAt = body.search(/\s/);
    const tag = (spaceAt === -1 ? body : body.slice(0, spaceAt)).trim();
    if (!tag) throw new XmlError("Empty tag name.");

    const attrs: Record<string, string> = {};
    if (spaceAt !== -1) {
      const attrRe = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
      const attrSrc = body.slice(spaceAt);
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrSrc)) !== null) {
        const key = m[1] ?? m[3];
        const value = m[2] ?? m[4] ?? "";
        attrs[key] = decode(value);
      }
    }

    nodes += 1;
    if (nodes > MAX_NODES) throw new XmlError("File is too large to import.");

    const node: XmlNode = { tag, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);

    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) throw new XmlError("File is nested too deeply.");
      stack.push(node);
    }

    i = gt + 1;
  }

  if (stack.length !== 1) {
    throw new XmlError(`Unclosed tag <${stack[stack.length - 1].tag}>.`);
  }
  return root;
}

// ------------------------------------------------------------------ helpers

export function findAll(node: XmlNode, predicate: (n: XmlNode) => boolean): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    if (predicate(n)) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

export function findFirst(node: XmlNode, predicate: (n: XmlNode) => boolean): XmlNode | null {
  if (predicate(node)) return node;
  for (const c of node.children) {
    const hit = findFirst(c, predicate);
    if (hit) return hit;
  }
  return null;
}

/** Direct-child `<field name="X">value</field>` lookup. */
export function fieldOf(block: XmlNode, name: string): string | null {
  for (const c of block.children) {
    if (c.tag === "field" && c.attrs.name === name) return c.text;
  }
  return null;
}

/** Direct-child `<value name="X">` or `<statement name="X">` wrapper. */
export function slotOf(block: XmlNode, name: string): XmlNode | null {
  for (const c of block.children) {
    if ((c.tag === "value" || c.tag === "statement") && c.attrs.name === name) return c;
  }
  return null;
}

export function isBlock(n: XmlNode, type?: string): boolean {
  const isB = n.tag === "block" || n.tag === "shadow";
  return type ? isB && n.attrs.type === type : isB;
}
