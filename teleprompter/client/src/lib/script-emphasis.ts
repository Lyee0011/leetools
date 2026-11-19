export type ScriptRun = { text: string; bold: boolean };

function appendRun(runs: ScriptRun[], text: string, bold: boolean) {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && last.bold === bold) last.text += text;
  else runs.push({ text, bold });
}

// Inline **bold** only. Incomplete markers and escaped stars stay readable.
export function scriptRuns(script: string): ScriptRun[] {
  const parts = script.split(/(\r\n|\r|\n|\\[\\*]|\*\*)/);
  const runs: ScriptRun[] = [];
  const literal = (part: string) => /^\\[\\*]$/.test(part) ? part.slice(1) : part;
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === "**") {
      let end = i + 1;
      let content = "";
      while (end < parts.length && !/^(\*\*|\r\n|\r|\n)$/.test(parts[end])) {
        content += literal(parts[end]);
        end += 1;
      }
      if (parts[end] === "**") {
        appendRun(runs, content.trim() ? content : "**" + content + "**", !!content.trim());
        i = end;
        continue;
      }
    }
    appendRun(runs, literal(parts[i]), false);
  }
  return runs;
}

function alignClipboardText(runs: ScriptRun[], plain: string): ScriptRun[] | null {
  if (!plain) return runs;
  const letters: ScriptRun[] = [];
  runs.forEach(run => {
    for (let i = 0; i < run.text.length; i += 1) {
      if (!/\s/.test(run.text[i])) letters.push({ text: run.text[i], bold: run.bold });
    }
  });
  const aligned: ScriptRun[] = [];
  let cursor = 0;
  let lineStart = true;
  for (let i = 0; i < plain.length; i += 1) {
    const character = plain[i];
    const next = letters[cursor];
    if (/\s/.test(character)) {
      const previous = letters[cursor - 1];
      appendRun(aligned, character, !!(previous && next && previous.bold && next.bold));
      if (character === "\n") lineStart = true;
      continue;
    }
    if (lineStart && (!next || character !== next.text)) {
      const label = plain.slice(i).match(/^(?:[-*•·‣◦▪●]|\d+[.)、])[\t ]+/);
      if (label) {
        appendRun(aligned, label[0], false);
        i += label[0].length - 1;
        lineStart = false;
        continue;
      }
    }
    if (!next || character !== next.text) return null;
    appendRun(aligned, character, next.bold);
    cursor += 1;
    lineStart = false;
  }
  return cursor === letters.length ? aligned : null;
}

// Read an inert, detached tree. Never mount pasted HTML, scripts or media.
// Plain text controls spacing/list labels; ambiguous matches use native paste.
export function richClipboardScript(html: string, plain: string): string | null {
  const template = document.createElement("template");
  template.innerHTML = html;
  let runs: ScriptRun[] = [];
  let trailingParagraphBreak = false;
  const blockTags = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DIV|DL|DT|DD|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL)$/;
  const ignoredTags = /^(SCRIPT|STYLE|NOSCRIPT|IFRAME|OBJECT|EMBED|SVG|MATH|HEAD|TEMPLATE)$/;
  function lineBreak() {
    const last = runs[runs.length - 1];
    if (last && !/\n$/.test(last.text)) {
      appendRun(runs, "\n", false);
      trailingParagraphBreak = true;
    }
  }
  function walk(node: Node, bold: boolean, preformatted: boolean) {
    if (node.nodeType === 3) {
      let text = (node.nodeValue ?? "").replace(/\r\n?/g, "\n");
      if (!preformatted) {
        if (/^\s*\n\s*$/.test(text)) return;
        text = text.replace(/[\t\n ]+/g, " ");
      }
      appendRun(runs, text, bold);
      if (text) trailingParagraphBreak = false;
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const tag = node.nodeName;
    if (ignoredTags.test(tag)) return;
    if (tag === "BR") { appendRun(runs, "\n", false); trailingParagraphBreak = false; return; }
    const block = blockTags.test(tag);
    if (block) lineBreak();
    if (tag === "B" || tag === "STRONG") bold = true;
    if (node instanceof HTMLElement) {
      const weight = node.style.fontWeight;
      if (weight === "bold" || weight === "bolder") bold = true;
      else if (weight === "normal" || weight === "lighter") bold = false;
      else if (/^\d+$/.test(weight)) bold = Number(weight) >= 600;
      preformatted = tag === "PRE" || /^(pre|pre-wrap|break-spaces)$/.test(node.style.whiteSpace) || preformatted;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child, bold, preformatted);
    if (block) lineBreak();
  }
  walk(template.content, false, false);
  const last = runs[runs.length - 1];
  if (trailingParagraphBreak && last?.text === "\n") runs.pop();
  else if (trailingParagraphBreak && last) last.text = last.text.slice(0, -1);
  if (!runs.some(run => run.bold && run.text.trim())) return null;
  const aligned = alignClipboardText(runs, plain.replace(/\r\n?/g, "\n"));
  if (!aligned) return null;
  runs = aligned;
  return runs.map(run => {
    const escaped = run.text.replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
    if (!run.bold) return escaped;
    return escaped.split("\n").map(line => line.trim() ? "**" + line + "**" : line).join("\n");
  }).join("");
}
