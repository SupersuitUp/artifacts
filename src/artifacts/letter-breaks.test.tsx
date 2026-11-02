import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactMarkdown } from './render.js'

const html = (md: string) => renderToStaticMarkup(<ArtifactMarkdown markdown={md} />)

// A letter ending "Your friend in Christ," then "Gary" on a plain newline was drawn as one line,
// because markdown joins a soft break with a space (Gary, 2026-11-02: "Permanently fix the newline
// issue with the salutation"). No writer types the two trailing spaces a hard break needs.
describe('a letter keeps its greeting and sign-off on their own lines', () => {
  it('breaks after a short opening line ending in a comma, and after the short lines under it', () => {
    expect(html('Your friend in Christ,\nGary')).toContain('Your friend in Christ,<br/>')
    expect(html('With gratitude,\nGary Sheng\nContinental Works')).toMatch(/With gratitude,<br\/>\s*Gary Sheng<br\/>\s*Continental Works/)
    expect(html('Hey Ana,\nIt has been a few weeks since we talked and I wanted to catch you up.')).toContain('Hey Ana,<br/>')
  })
  it('keeps the sign-off break when the name is bold', () => {
    expect(html('Love,\n**Gary**')).toMatch(/Love,<br\/>\s*<strong>Gary<\/strong>/)
  })
  it('still joins hard-wrapped prose', () => {
    expect(html('This paragraph is hard wrapped at a normal width, as a state file is,\nand it keeps joining.')).not.toContain('<br')
    expect(html('Short line\nGary')).not.toContain('<br')
  })
})
