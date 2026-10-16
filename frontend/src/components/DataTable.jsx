import React from 'react';
import Pagination, { usePagination } from './Pagination';

// Generic dense data-grid - the Table view alternative to a page's default
// list/card view. `columns` is [{ key, label, render(row), align, width }];
// `render` defaults to `row[key]` when omitted. Deliberately no built-in
// sorting/filtering of its own - every list page that uses this already
// has its own filter/sort controls driving `rows`, so this only ever
// renders whatever it's handed. It pages them like workspace Table does
// (components/Pagination.jsx); `pagination={false}` shows every row.
export default function DataTable({ columns, rows, getRowKey, onRowClick, emptyText = 'Nothing to show.', pagination, noun }) {
  const list = rows || [];
  const pager = usePagination(list, { resetKey: `${list.length}:${list.length ? getRowKey(list[0]) : ''}` });
  if (list.length === 0) {
    return (
      <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
        {emptyText}
      </div>
    );
  }
  const shown = pagination === false ? list : pager.pageRows;
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{
                  textAlign: c.align || 'left', padding: '8px 12px', borderBottom: '2px solid var(--color-border)',
                  color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', width: c.width
                }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'list-row' : undefined}
                style={{ cursor: onRowClick ? 'pointer' : 'default', borderBottom: '1px solid var(--color-border)' }}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: '8px 12px', textAlign: c.align || 'left', verticalAlign: 'middle' }}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination !== false && <Pagination {...pager.props} noun={noun} />}
    </div>
  );
}
