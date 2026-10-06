const fs = require('fs');
const path = require('path');

// Uploaded files on disk, by the /api/files/<name> URL the database keeps.

// The file's path inside UPLOAD_DIR, or null for no URL or one that would
// lead outside it.
function uploadPath(url) {
  if (!url) return null;
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  const file = path.join(dir, path.basename(String(url)));
  return file.startsWith(dir + path.sep) ? file : null;
}

// Deletes the files nothing refers to any more - a replaced or removed
// upload. Call it after the change that dropped the reference has been
// saved. Never throws: a file left behind is only wasted space.
async function removeUploads(...urls) {
  for (const url of urls.flat()) {
    const file = uploadPath(url);
    if (file) await fs.promises.rm(file, { force: true }).catch(() => {});
  }
}

module.exports = { uploadPath, removeUploads };
