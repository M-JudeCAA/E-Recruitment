import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Pagination, { pageItems, preferredPageSize, DEFAULT_PAGE_SIZE } from '../../src/components/Pagination';
import { Table } from '../../src/components/workspace/ui';
import DataTable from '../../src/components/DataTable';

// The one pagination footer every table uses (components/Pagination.jsx).
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}` }));
const columns = [{ key: 'name', label: 'Name' }];
const names = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent);

describe('pageItems', () => {
  test('lists every page while there are few', () => {
    expect(pageItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test('keeps the first, the last and the pages around the current one, with gaps', () => {
    expect(pageItems(1, 12)).toEqual([1, 2, 3, 4, 5, null, 12]);
    expect(pageItems(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    expect(pageItems(12, 12)).toEqual([1, null, 8, 9, 10, 11, 12]);
  });
});

describe('Table pages its rows', () => {
  test('shows the first page and says how many there are', () => {
    render(<Table columns={columns} rows={people(60)} getRowKey={(r) => r.id} noun="people" />);
    expect(names()).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(names()[0]).toBe('Person 1');
    expect(screen.getByText('Showing 1-25 of 60 people')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
  });

  test('moves between pages', async () => {
    render(<Table columns={columns} rows={people(60)} getRowKey={(r) => r.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(names()[0]).toBe('Person 26');
    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(names()).toEqual(['Person 51', 'Person 52', 'Person 53', 'Person 54', 'Person 55', 'Person 56', 'Person 57', 'Person 58', 'Person 59', 'Person 60']);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  test('a new rows-per-page choice starts again at page 1 and is remembered', async () => {
    render(<Table columns={columns} rows={people(60)} getRowKey={(r) => r.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '10');
    expect(names()).toHaveLength(10);
    expect(names()[0]).toBe('Person 1');
    expect(preferredPageSize()).toBe(10);
  });

  test('goes back to page 1 when the rows change (a filter)', async () => {
    function Filtered() {
      const [all, setAll] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setAll(false)}>Filter</button>
          <Table columns={columns} rows={all ? people(60) : people(40)} getRowKey={(r) => r.id} />
        </>
      );
    }
    render(<Filtered />);
    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(names()[0]).toBe('Person 1');
  });

  test('no footer while every row fits on the smallest page', () => {
    render(<Table columns={columns} rows={people(8)} getRowKey={(r) => r.id} />);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  test('pagination={false} shows every row', () => {
    render(<Table columns={columns} rows={people(60)} getRowKey={(r) => r.id} pagination={false} />);
    expect(names()).toHaveLength(60);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  test('a list paged on the server shows the rows it is given and asks for the next page', async () => {
    const onPageChange = vi.fn();
    render(<Table columns={columns} rows={people(25)} getRowKey={(r) => r.id}
      pagination={{ page: 1, pageSize: 25, total: 300, onPageChange }} noun="applications" />);
    expect(names()).toHaveLength(25);
    expect(screen.getByText('Showing 1-25 of 300 applications')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

test('DataTable pages its rows too', async () => {
  render(<DataTable columns={columns} rows={people(30)} getRowKey={(r) => r.id} />);
  expect(names()).toHaveLength(25);
  await userEvent.click(screen.getByRole('button', { name: 'Page 2' }));
  expect(names()).toEqual(['Person 26', 'Person 27', 'Person 28', 'Person 29', 'Person 30']);
});

test('the footer can be used on its own, and does nothing while loading', async () => {
  const onPageChange = vi.fn();
  render(<Pagination page={2} pageSize={10} total={45} onPageChange={onPageChange} loading />);
  const nav = screen.getByRole('navigation', { name: 'Pagination' });
  expect(within(nav).getByText('Showing 11-20 of 45 rows')).toBeInTheDocument();
  expect(within(nav).getByRole('button', { name: 'Next page' })).toBeDisabled();
});
