# Plan: File GitHub Bug Report — Floor Sidebar Text Truncation

## Context
The Building Panel sidebar (280px fixed width) causes text overflow/truncation in expanded floor sections. Room names, agent counts, and floor action buttons are clipped, hurting readability.

## Action
Create a single GitHub issue with:
- **Labels**: `bug`, `ui`, `phase-6`
- **Title**: `bug(ui): floor sidebar room cards truncate names, agent counts, and action buttons`
- **Body**: Detailed reproduction steps, affected components, file references, and screenshots description

## Files Referenced (not modified)
- `public/ui/css/building.css` — room card and floor bar styles
- `public/ui/css/tokens.css` — `--sidebar-width: 280px`
- `public/ui/views/building-view.js` — rendering logic
- `public/ui/css/responsive.css` — sidebar responsive rules

## No code changes — issue filing only.
