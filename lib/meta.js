// Server-side <head> injection so search engines and social crawlers (which
// don't run the client JS that fills in the rest of the page) see real
// per-page titles, descriptions, Open Graph/Twitter tags, and JSON-LD.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * @param {string} html - the page's raw HTML (already has a <title> and a
 *   <meta name="description"> tag, which are replaced in place).
 * @param {{title:string, description:string, url:string, image?:string, jsonLd?:object}} meta
 */
function injectMeta(html, { title, description, url, image, jsonLd }) {
  let out = html
    .replace(/<title>.*?<\/title>/s, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`);

  const tags = [
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
  ];
  if (image) {
    tags.push(`<meta property="og:image" content="${esc(image)}">`, `<meta name="twitter:image" content="${esc(image)}">`);
  }
  if (jsonLd) {
    tags.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
  }
  return out.replace("</head>", tags.join("\n") + "\n</head>");
}

module.exports = { injectMeta };
