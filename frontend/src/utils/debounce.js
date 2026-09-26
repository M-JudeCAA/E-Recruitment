// A burst of WS events (e.g. bulk-shortlisting several applications) should
// trigger one refetch, not one per event - every dashboard view's
// useDashboardEvents handler wraps its refetch in this.
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
