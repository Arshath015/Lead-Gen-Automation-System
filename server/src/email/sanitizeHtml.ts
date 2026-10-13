import sanitizeHtml from "sanitize-html";

// Signature is authored through our own rich-text editor, but the API
// accepts raw HTML directly (PUT /automation/settings) and this HTML is
// later embedded verbatim into real outgoing emails and re-rendered inside
// our own app — so it's sanitized on the way in regardless of what produced
// it, not just trusted because "the editor wouldn't send that".
const ALLOWED_TAGS = [
  "p",
  "br",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "a",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "blockquote",
  "hr",
  "img",
  "span",
  "div",
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "target", "rel"],
  // data-signature-asset-id links an <img> back to an uploaded
  // SignatureImageAsset — composeEmailBody reads it at send time to swap the
  // src for a cid: reference and attach the actual image bytes inline.
  img: ["src", "alt", "width", "height", "data-signature-asset-id"],
  "*": ["style"],
};

const ALLOWED_STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    "text-align": [/^left$|^right$|^center$|^justify$/],
    "font-weight": [/^\d+$|^bold$|^normal$/],
    "font-style": [/^italic$|^normal$/],
    "text-decoration": [/^underline$|^none$|^line-through$/],
  },
};

export function sanitizeSignatureHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  }).trim();
}

// Plain-text fallback for email clients that don't render HTML — required
// alongside the html body for deliverability best practice, and used as the
// signature portion of the `text` field. sanitize-html's tag-stripping alone
// concatenates block elements with no separator ("<p>A</p><p>B</p>" -> "AB"),
// so block boundaries are turned into newlines first.
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|div|li|h1|h2|h3|blockquote)>/gi, "\n");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
