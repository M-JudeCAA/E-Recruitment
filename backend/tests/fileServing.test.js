const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

// Uploads land in, and are served from, a throwaway folder.
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erec-files-'));
process.env.UPLOAD_DIR = uploadDir;
const { upload } = require('../src/middleware/upload');
const { sendUploadedFile, sendPreview, downloadOptions, downloadName } = require('../src/controllers/fileController');
const { buildRequisitionDocx } = require('../scripts/lib/requisitionDocument');

function app() {
  const a = express();
  a.post('/upload', upload.single('file'), (req, res) => res.json({ filename: req.file.filename }));
  a.get('/files/:filename/preview', (req, res) => sendPreview(res, req.params.filename));
  a.get('/files/:filename', (req, res) => sendUploadedFile(res, req.params.filename, downloadOptions(req)));
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

  it("lets only the app's own sites frame a PDF, without the API's default-src 'none'", async () => {
    write('framed.pdf', '%PDF-1.4');
    const res = await request(app()).get('/files/framed.pdf');
    expect(res.headers['content-security-policy']).toMatch(/^frame-ancestors 'self'/);
    expect(res.headers['content-security-policy']).not.toMatch(/default-src/);
    // So the PDF viewer's own download button can fetch it again.
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
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

describe('the document viewer (preview on click, download on request)', () => {
  const write = (name, body = 'x') => fs.writeFileSync(path.join(uploadDir, name), body);

  it('downloads a PDF only when asked, under the name the document goes by', async () => {
    write('c.pdf', '%PDF-1.4');
    const res = await request(app()).get('/files/c.pdf').query({ download: '1', name: 'My CV (final).PDF' });
    expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="My CV (final).pdf"');
  });

  it('keeps a download name to safe characters and the stored type', () => {
    expect(downloadName('../../etc/passwd', 'x.pdf')).toBe('.. .. etc passwd.pdf'); // no folders
    expect(downloadName('report.exe', 'x.docx')).toBe('report.docx');
    expect(downloadName('', 'abc.png')).toBe('abc.png');
  });

  it('shows a PDF or an image as it is', async () => {
    write('d.pdf', '%PDF-1.4');
    write('e.png', 'png');
    expect((await request(app()).get('/files/d.pdf/preview')).body).toEqual({ kind: 'pdf' });
    expect((await request(app()).get('/files/e.png/preview')).body).toEqual({ kind: 'image' });
  });

  it('turns a Word document into clean HTML', async () => {
    write('f.docx', await buildRequisitionDocx({ jobTitle: 'Pilot <img src=x onerror=alert(1)>' }));
    const res = await request(app()).get('/files/f.docx/preview');
    expect(res.body.kind).toBe('html');
    expect(res.body.html).toContain('Pilot &lt;img src=x onerror=alert(1)&gt;');
    expect(res.body.html).not.toMatch(/<img|<script/i);
  });

  it('offers only the download for an old .doc, or a file that is not really a Word document', async () => {
    write('g.doc', 'old word');
    write('h.docx', 'not a zip');
    expect((await request(app()).get('/files/g.doc/preview')).body).toEqual({ kind: 'none' });
    expect((await request(app()).get('/files/h.docx/preview')).body).toEqual({ kind: 'none' });
  });

  it('refuses a preview outside the upload folder', async () => {
    expect((await request(app()).get(`/files/${encodeURIComponent('..')}/preview`)).status).toBe(404);
  });
});
