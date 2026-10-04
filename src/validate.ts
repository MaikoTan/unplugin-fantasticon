import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Minimal, dependency-free well-formedness check for SVG source.
 *
 * `@twbs/fantasticon` pipes each SVG through `svgicons2svgfont`, which calls
 * `dest.destroy()` on a parse error. The stream handed to it is an
 * `fs.ReadStream` that has no `destroy()` in that code path, so one malformed
 * file takes down the whole dev server process instead of raising a catchable
 * error. Validating up front lets us fail gracefully rather than crash.
 *
 * This checks structural well-formedness only (balanced tags, terminated
 * constructs) rather than performing full XML validation, which is enough to
 * catch the hand-editing mistakes that actually occur in an icons directory.
 */
export function validateSvg(source: string): string | undefined {
  // Strip comments, CDATA, and doctype declarations so their contents are not
  // mistaken for markup.
  const text = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?>/gi, '')

  const stack: string[] = []
  let i = 0

  /** Find the `>` that closes a tag, ignoring any inside quoted attributes. */
  const findTagEnd = (from: number): number => {
    let quote: string | undefined
    for (let j = from; j < text.length; j++) {
      const ch = text[j]
      if (quote) {
        if (ch === quote)
          quote = undefined
      }
      else if (ch === '"' || ch === '\'') {
        quote = ch
      }
      else if (ch === '>') {
        return j
      }
    }
    return -1
  }

  while (i < text.length) {
    const open = text.indexOf('<', i)
    if (open === -1)
      break

    const close = findTagEnd(open + 1)
    if (close === -1)
      return 'unterminated tag'

    const tag = text.slice(open + 1, close).trim()
    i = close + 1

    // Processing instruction or declaration: opens nothing.
    if (tag.startsWith('?') || tag.startsWith('!'))
      continue

    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim()
      const expected = stack.pop()
      if (expected === undefined)
        return `unexpected closing tag </${name}>`
      if (expected !== name)
        return `mismatched tags: <${expected}> closed by </${name}>`
      continue
    }

    const name = /^([^\s/>]+)/.exec(tag)?.[1]
    if (!name)
      return 'malformed tag'

    // Self-closing tags open nothing.
    if (!tag.endsWith('/'))
      stack.push(name)
  }

  if (stack.length)
    return `unclosed tag <${stack[stack.length - 1]}>`

  // A '<' that never closed into a tag.
  if (text.slice(text.lastIndexOf('>') + 1).includes('<'))
    return 'malformed markup'

  return undefined
}

/**
 * Validate every `.svg` under `dir`, recursively.
 * Returns a human-readable problem per offending file.
 */
export async function findInvalidSvgs(dir: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true })
  }
  catch {
    return []
  }

  const invalid: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.svg'))
      continue

    const full = join(entry.parentPath ?? dir, entry.name)
    try {
      const problem = validateSvg(await readFile(full, 'utf8'))
      if (problem)
        invalid.push(`${entry.name} (${problem})`)
    }
    catch (error) {
      invalid.push(`${entry.name} (unreadable: ${error instanceof Error ? error.message : String(error)})`)
    }
  }
  return invalid
}
