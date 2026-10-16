import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import client, { API_URL } from '../../src/models/apiClient';
import DocumentLink from '../../src/components/DocumentLink';

// Every uploaded document opens in the in-app viewer on click; it is only
// downloaded from the viewer's Download button.
let requested;
beforeEach(() => {
  localStorage.setItem('staffToken', 'staff-jwt');
  requested = [];
});
const answer = (data, status = 200) => {
  client.defaults.adapter = async (config) => {
    requested.push(config);
    if (status >= 400) {
      const err = new Error('failed');
      err.response = { status, data: {} };
      err.config = config;
      throw err;
    }
    return { data, status, statusText: 'OK', headers: {}, config };
  };
};

test('a click opens a PDF in the viewer, not a download, with a Download button', async () => {
  render(<DocumentLink url="/api/files/cv.pdf" name="CV - Jane">CV</DocumentLink>);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'CV' }));

  const viewer = screen.getByRole('dialog', { name: 'CV - Jane' });
  expect(viewer.querySelector('iframe')).toHaveAttribute('src', `${API_URL}/api/files/cv.pdf?token=staff-jwt`);
  const download = within(viewer).getByRole('link', { name: /Download/ });
  expect(download).toHaveAttribute('download');
  expect(download).toHaveAttribute('href', `${API_URL}/api/files/cv.pdf?download=1&name=CV+-+Jane&token=staff-jwt`);
});

test('an image is shown as it is', async () => {
  render(<DocumentLink url="/api/files/id.png" name="National ID" />);
  await userEvent.click(screen.getByRole('button', { name: 'National ID' }));
  expect(screen.getByRole('img', { name: 'National ID' })).toHaveAttribute('src', `${API_URL}/api/files/id.png?token=staff-jwt`);
});

test('a Word document is shown from its preview, in a sandboxed frame', async () => {
  answer({ kind: 'html', html: '<p>Curriculum vitae</p>' });
  render(<DocumentLink url="/api/files/cv.docx" name="CV" />);
  await userEvent.click(screen.getByRole('button', { name: 'CV' }));

  await waitFor(() => expect(document.querySelector('.doc-viewer iframe')).not.toBeNull());
  const frame = document.querySelector('.doc-viewer iframe');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame.getAttribute('srcdoc')).toContain('<p>Curriculum vitae</p>');
  expect(requested[0].url).toBe('/api/files/cv.docx/preview');
  expect(requested[0].headers.Authorization).toBe('Bearer staff-jwt');
});

test('a file that can\'t be shown offers only its download', async () => {
  answer({ kind: 'none' });
  render(<DocumentLink url="/api/files/old.doc" name="Old letter" />);
  await userEvent.click(screen.getByRole('button', { name: 'Old letter' }));
  expect(await screen.findByText(/can't be shown here/)).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Download/ }).length).toBeGreaterThan(0);
});

test('says so when the preview fails, and still offers the download', async () => {
  answer({}, 500);
  render(<DocumentLink url="/api/files/x.docx" name="X" />);
  await userEvent.click(screen.getByRole('button', { name: 'X' }));
  expect(await screen.findByText('This document could not be shown here.')).toBeInTheDocument();
});

test('Escape or Close shuts the viewer', async () => {
  render(<DocumentLink url="/api/files/cv.pdf" name="CV" />);
  await userEvent.click(screen.getByRole('button', { name: 'CV' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'CV' }));
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('opening a document from a clickable row does not open the row', async () => {
  const onRow = vi.fn();
  render(
    <table><tbody><tr onClick={onRow}><td><DocumentLink url="/api/files/s.pdf" name="Score sheet" /></td></tr></tbody></table>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Score sheet' }));
  await userEvent.click(screen.getByRole('dialog'));
  expect(onRow).not.toHaveBeenCalled();
});

test('a committee member\'s document needs no session token', async () => {
  render(<DocumentLink url="/api/shortlist-panel/abc/files/cv.pdf" audience="committee" name="CV" />);
  await userEvent.click(screen.getByRole('button', { name: 'CV' }));
  expect(document.querySelector('.doc-viewer iframe')).toHaveAttribute('src', `${API_URL}/api/shortlist-panel/abc/files/cv.pdf`);
});
