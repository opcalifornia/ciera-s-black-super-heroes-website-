// Transactional email via Resend. When RESEND_API_KEY isn't set (local dev,
// or before the client has an account), emails are logged to the console
// instead of failing the request that triggered them.
const store = require("../db");

const FROM = process.env.RESEND_FROM_EMAIL || "Book Store <onboarding@resend.dev>";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

let _resend = null;
function getResend() {
  if (_resend) return _resend;
  const { Resend } = require("resend");
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (cents) => "$" + ((cents || 0) / 100).toFixed(2);

function wrap(site, title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#eef0ec;font-family:Georgia,'Times New Roman',serif;color:#1a2230;">
    <div style="max-width:560px;margin:0 auto;padding:2rem 1.25rem;">
      <p style="font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:1.1rem;letter-spacing:-.01em;margin:0 0 1.5rem;">${esc(site.storeName || "[Publisher or imprint name]")}</p>
      <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:1.4rem;margin:0 0 1rem;">${esc(title)}</h1>
      ${bodyHtml}
      <p style="margin-top:2rem;padding-top:1rem;border-top:1px solid #c9cdc6;font-family:Arial,Helvetica,sans-serif;font-size:.8rem;color:#5d6573;">${esc(site.storeName || "")}${site.contactEmail ? " · " + esc(site.contactEmail) : ""}</p>
    </div></body></html>`;
}

function orderLinesHtml(order) {
  return `<table style="width:100%;border-collapse:collapse;margin:1rem 0;">
    ${order.lines.map((l) => `<tr><td style="padding:.4rem 0;border-bottom:1px solid #c9cdc6;">${esc(l.title)} × ${l.qty}</td><td style="padding:.4rem 0;border-bottom:1px solid #c9cdc6;text-align:right;">${money(l.unitPrice * l.qty)}</td></tr>`).join("")}
    <tr><td style="padding:.6rem 0 0;">Subtotal</td><td style="padding:.6rem 0 0;text-align:right;">${money(order.subtotal)}</td></tr>
    <tr><td>Shipping</td><td style="text-align:right;">${order.shipping ? money(order.shipping) : "Free"}</td></tr>
    <tr><td style="font-weight:700;">Total</td><td style="font-weight:700;text-align:right;">${money(order.total)}</td></tr>
  </table>`;
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email:log-only] to=${to} subject="${subject}"\n${html}`);
    return { logged: true };
  }
  try {
    const resend = getResend();
    return await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.error(`Email send failed (to=${to}, subject="${subject}"):`, err.message);
    return { error: err.message };
  }
}

async function sendOrderConfirmation(order) {
  const site = store.getSite();
  const html = wrap(
    site,
    `Order #${order.number} confirmed`,
    `
    <p>Thanks for your order! Here's a summary:</p>
    ${orderLinesHtml(order)}
    <p>We'll be in touch with shipping details${order.customer.address ? "." : " once your address is on file."}</p>`
  );
  return sendEmail({ to: order.customer.email, subject: `Order #${order.number} confirmed`, html });
}

async function sendOwnerOrderAlert(order) {
  if (!ADMIN_EMAIL) {
    console.log(`[email:no-admin-email] New order #${order.number} — set ADMIN_EMAIL to receive alerts.`);
    return;
  }
  const site = store.getSite();
  const html = wrap(
    site,
    `New order #${order.number}`,
    `
    <p>${esc(order.customer.name)} (${esc(order.customer.email)}) just paid.</p>
    ${orderLinesHtml(order)}
    <p style="white-space:pre-line;">${esc(order.customer.address || "No shipping address on file yet.")}</p>`
  );
  return sendEmail({ to: ADMIN_EMAIL, subject: `New order #${order.number} — ${money(order.total)}`, html });
}

async function sendContactAlert(message) {
  if (!ADMIN_EMAIL) {
    console.log(`[email:no-admin-email] New contact message from ${message.email} — set ADMIN_EMAIL to receive alerts.`);
    return;
  }
  const site = store.getSite();
  const html = wrap(
    site,
    "New contact message",
    `
    <p><strong>${esc(message.name)}</strong> &lt;${esc(message.email)}&gt;${message.phone ? " · " + esc(message.phone) : ""}</p>
    <p style="white-space:pre-line;">${esc(message.message)}</p>`
  );
  return sendEmail({ to: ADMIN_EMAIL, subject: `New message from ${message.name}`, html });
}

module.exports = { sendOrderConfirmation, sendOwnerOrderAlert, sendContactAlert, sendEmail };
