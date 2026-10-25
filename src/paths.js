// Resolves a repo-root-relative asset path against the deploy base so the
// build works both at the origin (self-hosted, base "/") and under a
// subpath (GitHub Pages, base "./").
export const asset = path => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
