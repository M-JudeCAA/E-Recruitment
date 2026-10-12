import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  Chips, Figures, KeyValues, MenuButton, Meta, PageTop, SidePanel, Table, currentStaffId, formatDay, rankOf
} from '../../src/components/workspace/ui';
import { tokenWith } from '../helpers';

// The parts every staff page is built from.
describe('Table', () => {
  const columns = [
    { key: 'title', label: 'Vacancy' },
    { key: 'posts', label: 'Posts', align: 'right', render: (row) => `${row.posts} posts` }
  ];
  const rows = [{ id: 1, title: 'HR Officer', posts: 2 }, { id: 2, title: 'Pilot', posts: 1 }];

  test('shows a row per item, using a column\'s own rendering where it has one', () => {
    render(<Table columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Vacancy', 'Posts']);
    const [, first] = screen.getAllByRole('row');
    expect(within(first).getAllByRole('cell').map((c) => c.textContent)).toEqual(['HR Officer', '2 posts']);
  });

  test('says so when there is nothing to show', () => {
    render(<Table columns={columns} rows={[]} getRowKey={(r) => r.id} emptyText="No vacancies yet." />);
    expect(screen.getByText('No vacancies yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('a row opens its item when rows are clickable', async () => {
    const onRowClick = vi.fn();
    render(<Table columns={columns} rows={rows} getRowKey={(r) => r.id} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByText('Pilot'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });
});

describe('Chips', () => {
  const options = [{ key: 'all', label: 'All', count: 12 }, { key: 'open', label: 'Open', count: 0 }, { key: 'closed', label: 'Closed' }];

  test('mark the chosen filter and show each count, zero included', () => {
    render(<Chips options={options} value="open" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /^Open/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^All/ })).toHaveTextContent('All12');
    expect(screen.getByRole('button', { name: /^Open/ })).toHaveTextContent('Open0');
    expect(screen.getByRole('button', { name: 'Closed' })).toHaveTextContent(/^Closed$/);
  });

  test('choosing one reports its key', async () => {
    const onChange = vi.fn();
    render(<Chips options={options} value="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Closed' }));
    expect(onChange).toHaveBeenCalledWith('closed');
  });
});

describe('MenuButton', () => {
  const items = (extra = {}) => [
    { label: 'Readvertise', onClick: vi.fn() },
    false, // an action this user can't take
    { divider: true },
    { label: 'Close vacancy', danger: true, onClick: vi.fn(), ...extra }
  ];

  test('opens its actions, runs the one chosen and closes', async () => {
    const list = items();
    render(<MenuButton items={list} />);
    const toggle = screen.getByRole('button', { name: 'More actions' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Readvertise', 'Close vacancy']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close vacancy' }));
    expect(list[3].onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('closes on Escape and on a click elsewhere', async () => {
    render(<><MenuButton items={items()} /><p>Elsewhere</p></>);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByText('Elsewhere'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('a disabled action can\'t be run', async () => {
    const list = items({ disabled: true });
    render(<MenuButton items={list} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close vacancy' }));
    expect(list[3].onClick).not.toHaveBeenCalled();
  });

  test('is not shown when the user has no actions', () => {
    const { container } = render(<MenuButton items={[false, null]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SidePanel', () => {
  test('is a dialog that closes from its X and on Escape', async () => {
    const onClose = vi.fn();
    render(<SidePanel title="Jane Doe" onClose={onClose}>Application</SidePanel>);
    expect(screen.getByRole('dialog', { name: 'Jane Doe' })).toHaveTextContent('Application');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('leaves Escape to a dialog opened on top of it', async () => {
    const onClose = vi.fn();
    render(<SidePanel title="Jane Doe" onClose={onClose}><div className="modal-overlay">Reason?</div></SidePanel>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  test('stops the page behind it scrolling, and gives it back when closed', () => {
    const { unmount } = render(<SidePanel title="Jane Doe" onClose={() => {}}>Application</SidePanel>);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('page furniture', () => {
  test('a page header has the title every staff page shares, a crumb trail and its actions', () => {
    render(
      <MemoryRouter>
        <PageTop title="HR Officer" subtitle="Human Resource" actions={<button>Edit</button>}
          crumb={[{ label: 'Vacancies', to: '/hr' }, { label: 'UCAA/ADV/EXT/001/2026', mono: true }]} />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { level: 1, name: 'HR Officer' })).toHaveClass('page-title');
    expect(screen.getByRole('link', { name: 'Vacancies' })).toHaveAttribute('href', '/hr');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('UCAA/ADV/EXT/001/2026');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  test('a meta line skips what is empty but keeps a zero', () => {
    const { container } = render(<div><Meta parts={['External', null, '', false, undefined, 0, '2 posts']} /></div>);
    expect(container.querySelectorAll('.ws-dot')).toHaveLength(2);
    expect(container).toHaveTextContent('External·0·2 posts');
  });

  test('figures show a dash for a number not known yet, and a zero as zero', () => {
    render(<Figures figures={[{ label: 'Waiting', value: 0 }, { label: 'Overdue', value: null }]} />);
    expect(screen.getByText('Waiting').previousSibling).toHaveTextContent(/^0$/);
    expect(screen.getByText('Overdue').previousSibling).not.toHaveTextContent(/^$/);
  });

  test('key/value rows leave out a row that does not apply', () => {
    render(<KeyValues rows={[['Deadline', '16 Aug 2026'], null, ['Closed', undefined], ['Hiring manager', null]]} />);
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual(['Deadline', 'Hiring manager']);
  });
});

describe('who is signed in', () => {
  test('the staff id is read from the session token', () => {
    localStorage.setItem('staffToken', tokenWith({ id: 42, type: 'staff' }));
    expect(currentStaffId()).toBe(42);
  });

  test('no token, or one that can\'t be read, is nobody', () => {
    expect(currentStaffId()).toBeNull();
    localStorage.setItem('staffToken', 'not-a-token');
    expect(currentStaffId()).toBeNull();
  });

  test('roles rank in the same order as the API\'s', () => {
    const roles = ['HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director'];
    expect(roles.map(rankOf)).toEqual([1, 2, 3, 4, 5]);
    expect(rankOf(null)).toBe(0);
    expect(rankOf('Intern')).toBe(0);
  });

  test('days are written the same everywhere', () => {
    expect(formatDay('2026-08-16T12:00:00Z')).toBe('16 Aug 2026');
    expect(formatDay(null)).toBe('');
  });
});
