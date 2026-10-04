import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { findInvalidSvgs, validateSvg } from '../src/validate'

const valid = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M4 4 L20 20 Z"/>
</svg>`

describe('validateSvg', () => {
  it('accepts a well-formed svg', () => {
    expect(validateSvg(valid)).toBeUndefined()
  })

  it('accepts nested and self-closing elements', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>
      <g><path d="M0 0h1v1z"/></g>
    </svg>`
    expect(validateSvg(svg)).toBeUndefined()
  })

  it('accepts comments, doctype, and CDATA', () => {
    const svg = `<?xml version="1.0"?>
      <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
      <svg><!-- <path d="unclosed"/> --><style><![CDATA[ .a { fill: red } ]]></style></svg>`
    expect(validateSvg(svg)).toBeUndefined()
  })

  it('accepts angle brackets inside attribute values', () => {
    const svg = `<svg><path data-x="a > b"/></svg>`
    expect(validateSvg(svg)).toBeUndefined()
  })

  it('rejects an unclosed tag', () => {
    expect(validateSvg('<svg><path d="M0 0"/>')).toMatch(/unclosed tag <svg>/)
  })

  it('rejects an unterminated tag', () => {
    expect(validateSvg('<svg><path d="M0 0"')).toMatch(/unterminated tag/)
  })

  it('rejects mismatched tags', () => {
    expect(validateSvg('<svg><g></svg>')).toMatch(/mismatched tags/)
  })

  it('rejects a stray closing tag', () => {
    expect(validateSvg('</svg>')).toMatch(/unexpected closing tag/)
    expect(validateSvg('<svg></path></svg>')).toMatch(/mismatched tags/)
  })

  it('rejects the malformed svg that crashes fantasticon', () => {
    expect(validateSvg('<svg><<<not valid')).toBeDefined()
  })
})

describe('findInvalidSvgs', () => {
  it('reports offending files and ignores valid ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svg-'))
    await writeFile(join(dir, 'good.svg'), valid)
    await writeFile(join(dir, 'bad.svg'), '<svg><<<not valid')
    await mkdir(join(dir, 'nested'))
    await writeFile(join(dir, 'nested', 'deep.svg'), valid)
    await writeFile(join(dir, 'notes.txt'), 'ignore me')

    const invalid = await findInvalidSvgs(dir)
    expect(invalid).toHaveLength(1)
    expect(invalid[0]).toMatch(/^bad\.svg /)
  })

  it('returns empty for a missing directory', async () => {
    expect(await findInvalidSvgs(join(tmpdir(), 'does-not-exist-xyz'))).toEqual([])
  })
})
