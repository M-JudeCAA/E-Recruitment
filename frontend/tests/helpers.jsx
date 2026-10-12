import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// Shows where the router ended up, so a test can assert a redirect:
// expect(screen.getByTestId('location')).toHaveTextContent('/staff/login').
export function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

/**
 * Renders `element` at `path` inside a router. Any other address the element
 * navigates to renders the probe instead, so redirects can be asserted.
 */
export function renderAt(path, element, { route = path.split('?')[0] } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

// A session token whose payload carries `payload` (unsigned - the frontend
// only ever reads it for display).
export function tokenWith(payload) {
  const part = (value) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'none' })}.${part(payload)}.x`;
}
