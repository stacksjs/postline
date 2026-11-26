/**
 * CHANGELOG.md as data, for the public changelog page (#233).
 *
 * The file is written by the release script: a `## vX.Y.Z` heading per
 * release, then `## <emoji> <Kind>` groups of `- **scope**: change ([sha](url))`
 * lines, and a contributors list the page leaves out. Parsed rather than
 * rendered as Markdown, so the page decides how a release looks and nothing
 * in a commit message reaches it as HTML.
 */
export interface ChangelogItem { scope: string | null, text: string, commit: string | null }
export interface ChangelogGroup { title: string, items: ChangelogItem[] }
export interface ChangelogRelease { version: string, compare: string | null, groups: ChangelogGroup[] }

const ITEM = /^-\s+(?:\*\*([^*]+)\*\*:\s*)?(.*?)(?:\s*\(\[[0-9a-f]{7,}\]\((https:\/\/github\.com\/[^)\s]+)\)\))?(?:\s*_\(by [^)]*\)_)?\s*$/

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = []
  let release: ChangelogRelease | null = null
  let group: ChangelogGroup | null = null

  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    const version = line.match(/^##\s+(v\d+\.\d+\.\d+\S*)\s*$/)
    if (version) {
      release = { version: version[1]!, compare: null, groups: [] }
      releases.push(release)
      group = null
      continue
    }
    if (!release) continue
    const compare = line.match(/^\[Compare changes\]\((https:\/\/github\.com\/[^)\s]+)\)$/)
    if (compare) {
      release.compare = compare[1]!
      continue
    }
    const heading = line.match(/^##\s+(?:\S+\s+)?(.+)$/)
    if (heading) {
      group = /contributors/i.test(heading[1]!) ? null : { title: heading[1]!.trim(), items: [] }
      if (group) release.groups.push(group)
      continue
    }
    const item = group && line.match(ITEM)
    if (item && item[2]) group!.items.push({ scope: item[1]?.trim() || null, text: item[2].trim(), commit: item[3] || null })
  }
  return releases.map(entry => ({ ...entry, groups: entry.groups.filter(g => g.items.length) }))
}
