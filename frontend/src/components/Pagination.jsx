import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// The one pagination footer for every table in the system: "Showing 26-50 of
// 132", Previous / numbered pages / Next, and a rows-per-page choice.
//
// Two ways to use it:
//   - a list fetched whole: usePagination(rows) slices it and hands back the
//     props for <Pagination {...pager.props} /> (Table and DataTable do this
//     for you);
//   - a list paged on the server: pass page, pageSize, total and
//     onPageChange yourself (and onPageSizeChange if the API takes a size).
//
// The rows-per-page choice is remembered per viewer in this browser, for
// every table at once.

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;
const STORAGE_KEY = 'erecruitment.pageSize';

export function preferredPageSize(fallback = DEFAULT_PAGE_SIZE) {
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return PAGE_SIZE_OPTIONS.includes(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function rememberPageSize(size) {
  try { window.localStorage.setItem(STORAGE_KEY, String(size)); } catch { /* private window: not remembered */ }
}

export const pageCountOf = (total, pageSize) => Math.max(1, Math.ceil((total || 0) / pageSize));

// The page numbers to show: always the first and last, the current one and
// one either side, with null where a run is left out ("1 ... 4 5 6 ... 12").
export function pageItems(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const items = [1];
  const from = Math.max(2, Math.min(page - 1, pageCount - 4));
  const to = Math.min(pageCount - 1, Math.max(page + 1, 5));
  if (from > 2) items.push(null);
  for (let p = from; p <= to; p += 1) items.push(p);
  if (to < pageCount - 1) items.push(null);
  items.push(pageCount);
  return items;
}

/**
 * Pages through rows already in the browser. Goes back to the first page
 * when resetKey changes (by default, when the number of rows does - a new
 * filter or search), and never shows a page past the end.
 */
export function usePagination(rows, { pageSize: initialSize, resetKey } = {}) {
  const list = rows || [];
  const [pageSize, setPageSizeState] = useState(() => initialSize || preferredPageSize());
  const [page, setPage] = useState(1);
  const key = resetKey === undefined ? list.length : resetKey;
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) {
    setSeenKey(key);
    setPage(1);
  }
  const pageCount = pageCountOf(list.length, pageSize);
  const current = Math.min(page, pageCount);
  const offset = (current - 1) * pageSize;
  const setPageSize = (size) => {
    rememberPageSize(size);
    setPageSizeState(size);
    setPage(1);
  };
  return {
    page: current,
    pageSize,
    pageCount,
    offset,
    total: list.length,
    pageRows: list.slice(offset, offset + pageSize),
    setPage,
    setPageSize,
    props: { page: current, pageSize, total: list.length, onPageChange: setPage, onPageSizeChange: setPageSize }
  };
}

/**
 * Page and page size for a list paged on the server: send page/pageSize with
 * the request, then hand props(total) to <Pagination> (or Table's
 * `pagination`). Changing the size goes back to the first page.
 */
export function useServerPagination(initialSize) {
  const [page, setPage] = useState(1);
  const [pageSize, setSize] = useState(() => initialSize || preferredPageSize());
  const setPageSize = (size) => {
    rememberPageSize(size);
    setSize(size);
    setPage(1);
  };
  return {
    page, setPage, pageSize, setPageSize,
    props: (total) => ({ page, pageSize, total, onPageChange: setPage, onPageSizeChange: setPageSize })
  };
}

/** The footer. Renders nothing while every row fits on the smallest page. */
export default function Pagination({
  page, pageSize, total, onPageChange, onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS, loading = false, noun = 'rows'
}) {
  if (!total || total <= Math.min(pageSize, ...pageSizeOptions)) return null;
  const pageCount = pageCountOf(total, pageSize);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const go = (p) => { if (p >= 1 && p <= pageCount && p !== page && !loading) onPageChange(p); };
  const sizes = pageSizeOptions.includes(pageSize) ? pageSizeOptions : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <nav className="ws-pager" aria-label="Pagination">
      <span className="ws-pager-count" aria-live="polite">
        Showing {first.toLocaleString()}-{last.toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      {pageCount > 1 && (
        <div className="ws-pager-pages">
          <button type="button" className="ws-pager-btn" onClick={() => go(page - 1)} disabled={page <= 1 || loading} aria-label="Previous page">
            <ChevronLeft size={16} />
          </button>
          {pageItems(page, pageCount).map((p, i) => (p === null
            ? <span key={`gap-${i}`} className="ws-pager-gap" aria-hidden="true">...</span>
            : (
              <button key={p} type="button" className={`ws-pager-btn${p === page ? ' on' : ''}`} onClick={() => go(p)}
                disabled={loading} aria-label={`Page ${p}`} aria-current={p === page ? 'page' : undefined}>
                {p}
              </button>
            )))}
          <button type="button" className="ws-pager-btn" onClick={() => go(page + 1)} disabled={page >= pageCount || loading} aria-label="Next page">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      {onPageSizeChange && (
        <label className="ws-pager-size">
          Rows per page
          <select className="ws-field" value={pageSize} disabled={loading} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
    </nav>
  );
}
