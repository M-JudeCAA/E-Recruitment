const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

// Uploads land in, and are served from, a throwaway folder.
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erec-files-'));
process.env.UPLOAD_DIR = uploadDir;
const { upload } = require('../src/middleware/upload');
const { sendUploadedFile } = require('../src/controllers/fileController');

function app() {
  const a = express();
  a.post('/upload', upload.single('file'), (req, res) => res.json({ filename: req.file.filename }));
  a.get('/files/:filename', (req, res) => sendUploadedFile(res, req.params.filename));
  return a;
}

afterAll(() => fs.rmSync(uploadDir, { recursive: true, force: true }));

describe('stored upload names', () => {
  it('names the file by its type, not by the name the uploader gave it', async () => {
    const res = await request(app()).post('/upload')
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'cv.html', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.filename).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });
});

describe('serving uploads', () => {
  const write = (name, body = 'x') => fs.writeFileSync(path.join(uploadDir, name), body);

  it('shows a PDF in the tab, with nosniff', async () => {
    write('a.pdf', '%PDF-1.4');
    const res = await request(app()).get('/files/a.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('only ever downloads a file stored as a web page', async () => {
    write('old.html', '<script>alert(1)</script>');
    const res = await request(app()).get('/files/old.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('downloads Word documents rather than rendering them', async () => {
    write('b.docx');
    const res = await request(app()).get('/files/b.docx');
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('refuses names that step outside the upload folder', async () => {
    fs.writeFileSync(`${uploadDir}-sibling.pdf`, 'x');
    const res = await request(app()).get(`/files/${encodeURIComponent(`..${path.sep}${path.basename(uploadDir)}-sibling.pdf`)}`);
    expect(res.status).toBe(404);
    fs.rmSync(`${uploadDir}-sibling.pdf`, { force: true });
  });
});
