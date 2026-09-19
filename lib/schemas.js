// zod request-validation schemas, one per API input. Kept close to the
// original hand-rolled checks (same limits, same "optional means blank")
// so validated data drops straight into the existing handlers.
const { z } = require("zod");

const emailField = z.string().trim().min(3, "Enter a valid email address.").max(200).email("Enter a valid email address.");
const optionalTrimmed = (max) => z.string().trim().max(max).optional().default("");
const nullableInt = () =>
  z.preprocess((v) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : null;
  }, z.number().int().nullable());
const nonNegativeInt = (fallback = 0) =>
  z.preprocess((v) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }, z.number().int().min(0));

const newsletterSchema = z.object({
  email: emailField,
});

const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: emailField,
  phone: optionalTrimmed(40),
  message: z.string().trim().min(1, "Enter a message.").max(5000),
});

const orderItemSchema = z.object({
  id: z.string().min(1),
  // Mirrors the old `parseInt(qty, 10) || 1` behavior: anything that
  // doesn't parse to a usable number quietly defaults to 1 instead of
  // rejecting the whole order over a stray cart value.
  qty: z.preprocess((v) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, z.number().int().min(1).max(20).optional().default(1)),
});
const orderSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Your cart is empty."),
  customer: z.object({
    name: z.string().trim().min(1, "Enter your name.").max(120),
    email: emailField,
    note: optionalTrimmed(1000),
  }),
});

const loginSchema = z.object({
  password: z.string().min(1, "Enter the admin password.").max(200),
});

const SITE_STRING_KEYS = [
  "storeName",
  "announcement",
  "bookTitle",
  "heroSubline",
  "endorsementQuote",
  "endorsementName",
  "endorsementCredentials",
  "ctaLabel",
  "amazonUrl",
  "amazonLabel",
  "releaseNote",
  "newsletterHeading",
  "newsletterBody",
  "contactIntro",
  "contactEmail",
  "privacyPolicy",
  "metaDescription",
];
const siteUpdateSchema = z
  .object({
    ...Object.fromEntries(SITE_STRING_KEYS.map((k) => [k, z.string().max(5000).optional()])),
    flatShipping: nonNegativeInt().optional(),
    freeShippingThreshold: nonNegativeInt().optional(),
  })
  .partial();

const productFields = {
  title: z.string().trim().min(1, "Enter a product title.").max(200),
  slug: z.string().trim().max(120).optional(),
  description: z.string().trim().max(5000).optional().default(""),
  price: nonNegativeInt().optional().default(0),
  compareAt: nullableInt().optional(),
  inventory: nullableInt().optional(),
  badge: optionalTrimmed(40),
  sort: nonNegativeInt().optional(),
  active: z.boolean().optional().default(true),
};
const productCreateSchema = z.object(productFields);
const productUpdateSchema = z.object(productFields).partial();

const orderStatusSchema = z.object({
  status: z.enum(["pending_payment", "paid", "shipped", "cancelled", "refunded"], {
    errorMap: () => ({ message: "Unknown status." }),
  }),
});
const messageReadSchema = z.object({ read: z.boolean() });
const imagesReorderSchema = z.object({ order: z.array(z.string().min(1)).min(1) });
const searchQuerySchema = z.object({ q: z.string().trim().max(100).optional().default("") });

// Express middleware factory: validates req[source] against a schema.
// Express 5's req.query is a read-only getter (recomputed fresh on every
// access, no setter), so the parsed result can't be written back to
// req.query itself — it goes on req.validated instead, and routes that
// validate a query string read req.validated.q rather than req.query.q.
function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] || {});
    if (!result.success) {
      const message = result.error.issues[0]?.message || "That request doesn't look right.";
      return res.status(400).json({ error: message });
    }
    if (source === "query") req.validated = result.data;
    else req[source] = result.data;
    next();
  };
}

module.exports = {
  validate,
  newsletterSchema,
  contactSchema,
  orderSchema,
  loginSchema,
  siteUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
  orderStatusSchema,
  messageReadSchema,
  imagesReorderSchema,
  searchQuerySchema,
};
