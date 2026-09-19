// Image upload handling: validate, resize with sharp, store under /uploads.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const FORMAT_EXT = { jpeg: "jpg", png: "png", webp: "webp" };
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Accept the upload at the HTTP layer based on its declared content type;
// the real check happens in resizeAndSave() by sniffing the decoded bytes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIMES.has(file.mimetype)) return cb(new Error("Only JPG, PNG, or WEBP images are allowed."));
    cb(null, true);
  },
});

/**
 * Resize an uploaded image buffer and save it under /uploads.
 * Returns the public URL path (e.g. "/uploads/abc123.webp").
 * Throws if the bytes aren't actually a jpg/png/webp image.
 */
async function resizeAndSave(buffer, { maxWidth = 2000 } = {}) {
  const image = sharp(buffer, { failOn: "truncated" });
  const meta = await image.metadata();
  const ext = FORMAT_EXT[meta.format];
  if (!ext) throw new Error("Only JPG, PNG, or WEBP images are allowed.");

  const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const outPath = path.join(UPLOAD_DIR, filename);
  const pipeline = image.rotate().resize({ width: maxWidth, withoutEnlargement: true });
  if (ext === "jpg") await pipeline.jpeg({ quality: 82, mozjpeg: true }).toFile(outPath);
  else if (ext === "png") await pipeline.png({ quality: 82, compressionLevel: 9 }).toFile(outPath);
  else await pipeline.webp({ quality: 82 }).toFile(outPath);

  return `/uploads/${filename}`;
}

function deleteUploadedFile(url) {
  if (!url || !url.startsWith("/uploads/")) return;
  const filePath = path.join(UPLOAD_DIR, path.basename(url));
  fs.unlink(filePath, () => {}); // best-effort; a missing file is fine
}

module.exports = { upload, resizeAndSave, deleteUploadedFile, UPLOAD_DIR, MAX_BYTES };
