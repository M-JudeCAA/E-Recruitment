# Frontend tests

```bash
npm test            # run everything once (what CI runs)
npm run test:watch  # re-run on save while you work
npx vitest run tests/routing/guards.test.jsx   # one file
npx vitest run -t "a rejection"                # tests whose name matches
```

[Vitest](https://vitest.dev) runs the tests in a simulated browser (jsdom), with
[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
for anything that renders. Nothing here needs the API, a database or a real browser.
Settings are in `vitest.config.js`; `tests/setup.js` runs before every file.

## What is covered

| Folder | What it checks |
| --- | --- |
| `utils/` | The rules the browser shares with the API: organisation codes, screening evidence and disqualifying questions, the NIN and password checks, profile completeness, file checks before upload, CSV export, interview dates and times |
| `offers/`, `workspace/pipeline.test.js` | How an offer reads to the candidate (lapsed, time left) and which stage an application is shown at |
| `components/`, `workspace/ui.test.jsx` | The shared building blocks: buttons, dialogs, the reason dialog, status badges, tables, filter chips, menus, the side panel |
| `routing/` | Who is shown which page: the role gates, the candidate gates, and the three sites told apart by port |
| `models/` | The API client (which session a request carries, what a failure says, ending a session the API refused), sign-in and sign-out, approving a vacancy with an exception |
| `views/` | Whole pages, with the API client mocked: so far only the committee member's list (paging, filters, search, prev/next) |

The big pages (the Inbox, the vacancy workspace, the apply wizard) are not covered yet.

## Writing a test

- Put it under `tests/`, in the folder matching the file under `src/`, named `*.test.js` (or `.jsx` if it renders).
- Name a test for the rule it protects, in plain words: `test('a Manager can't open a Director page', ...)`.
- Find things the way a person would - by role and name (`screen.getByRole('button', { name: 'Save' })`), not by class or test id.
- Several utilities mirror a backend file (`validators.js`, `screeningEvidence.js`, `orgFields.js`, ...). When you change one side, change the other and its test.
- Storage is emptied and the page cleared after every test, so each one starts signed out.

Helpers in `tests/helpers.jsx`:

- `renderAt(path, element)` renders inside a router; anywhere the element redirects to shows up in `screen.getByTestId('location')`.
- `tokenWith(payload)` makes a session token carrying that payload.

To stand in for the API, replace the client's adapter, as `models/apiClient.test.js` does, or mock the module
(`vi.mock('../../src/models/staffApiClient')`). To test a page on the staff or Internal Careers port, either mock
`staffPort`/`internalPort` (see `routing/guards.test.jsx`) or give the file its own address with a first-line comment
(see `routing/staffSite.test.js`).
