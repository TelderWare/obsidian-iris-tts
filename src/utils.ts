export function stripMarkdown(text: string): string {
  return (
    text
      // Remove YAML frontmatter
      .replace(/^---[\s\S]*?---\n?/, "")
      // Remove fenced code blocks
      .replace(/```[\s\S]*?```/g, "")
      // Remove inline code (keep content)
      .replace(/`([^`]+)`/g, "$1")
      // Remove images (keep alt text)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      // Remove links (keep text)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove wiki-links (keep display text or link)
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, link, display) => display || link)
      // Remove heading markers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bold/italic markers
      .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2")
      // Remove strikethrough
      .replace(/~~(.*?)~~/g, "$1")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, "")
      // Remove blockquote markers
      .replace(/^>\s?/gm, "")
      // Remove unordered list markers
      .replace(/^[\s]*[-*+]\s+/gm, "")
      // Remove ordered list markers
      .replace(/^[\s]*\d+\.\s+/gm, "")
      // Remove HTML tags
      .replace(/<[^>]+>/g, "")
      // Collapse multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function chunkText(text: string, maxLen: number): string[] {
  if (text.length === 0) return [];

  // First split on paragraph boundaries (double newlines)
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length > 0);

  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxLen) {
      chunks.push(para);
      continue;
    }
    // Split long paragraphs further
    let remaining = para;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      const segment = remaining.slice(0, maxLen);
      let splitIdx = -1;

      // Try to split at sentence boundary
      for (let i = segment.length - 1; i >= maxLen * 0.3; i--) {
        const ch = segment[i];
        if ((ch === "." || ch === "!" || ch === "?") && i + 1 < segment.length) {
          const next = segment[i + 1];
          if (next === " " || next === "\n" || next === "\r") {
            splitIdx = i + 1;
            break;
          }
        }
      }

      // Fall back to last space
      if (splitIdx === -1) {
        const spaceIdx = segment.lastIndexOf(" ");
        if (spaceIdx > maxLen * 0.3) {
          splitIdx = spaceIdx + 1;
        }
      }

      // Hard split as last resort
      if (splitIdx === -1) {
        splitIdx = maxLen;
      }

      const chunk = remaining.slice(0, splitIdx).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      remaining = remaining.slice(splitIdx).trimStart();
    }
  }

  return chunks;
}
