# Security

If you find a security issue, please report it privately rather than opening a
public GitHub issue.

- File a GitHub security advisory on this repository, or
- Email the maintainer listed in [AUTHORS.md](./AUTHORS.md).

We will respond within 7 days.

## Scope

- The Trimble Connect access token is held only in memory for the lifetime of
  the page. It is never written to `localStorage`, `sessionStorage`, cookies,
  or analytics.
- All Core API pagination follows are validated to stay on the originally
  discovered Core API origin before any bearer token is attached.
- Signed download/upload URLs are required to use HTTPS. The single exception
  is `http://localhost` and `http://127.0.0.1` during local development.
- User-provided strings (area names, file names) are escaped before they are
  written to SVG attributes.
