// iOS Safari zooms the whole page when a text field under 16px takes focus, and does not zoom
// back out, so a reader who taps into a comment box loses the page they were commenting on
// (reported from an iPhone on 2026-09-28). Every text field the reader draws uses this size.
// A viewport `maximum-scale` would also stop the zoom, but it takes pinch-zoom away from readers
// who need it, so the size is the fix.
export const NO_ZOOM_FONT = { fontSize: 16 } as const
