// Minimal allowlist HTML sanitizer for event descriptions. No DOM parser
// dependency (zero runtime deps beyond Next/React) — regex-based, scoped to
// the narrow tag set the catalogue actually uses. Defense in depth: the
// catalogue in events.ts is already trusted, hand-authored HTML, but this
// still strips anything outside the allowlist before it reaches the page.

const ALLOWED_TAGS = new Set(["p", "br", "ul", "ol", "li", "strong", "em", "b", "i", "a"]);

function safeHref(rawHref: string): string {
  const href = rawHref.trim();
  if (/^(https?:|mailto:)/i.test(href)) return href;
  return "";
}

export function sanitizeHtml(html: string): string {
  if (!html) return "";

  // Remove script/style blocks entirely (tag + contents).
  let out = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Remove HTML comments.
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Walk every tag. Allowed tags are kept (attributes stripped except a
  // sanitized href on <a>); everything else is dropped, keeping inner text.
  out = out.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    const isClosing = match.startsWith("</");

    if (!ALLOWED_TAGS.has(tag)) return "";

    if (tag === "a") {
      if (isClosing) return "</a>";
      const hrefMatch = attrs.match(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i);
      const rawHref = hrefMatch ? hrefMatch[1] ?? hrefMatch[2] ?? "" : "";
      const href = safeHref(rawHref);
      if (!href) return "<a>";
      return `<a href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">`;
    }

    return isClosing ? `</${tag}>` : `<${tag}>`;
  });

  // Calendly's editor emits "<p><br></p>" spacer paragraphs between real
  // paragraphs. Paragraph margins already provide that spacing, so these
  // only double the gap on the page. Drop them.
  out = out.replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "");

  return out.trim();
}
