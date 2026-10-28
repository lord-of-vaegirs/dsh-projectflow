#!/usr/bin/env node
/**
 * Fail a release if tracked or built text contains obvious personal paths or
 * credentials. It prints the rule and location, never the matching value.
 */
import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const ACCOUNT = String.raw`[A-Za-z0-9._-]+`
const ALLOWED = new Set(['me', '...', 'runner', 'user', 'username', 'example', 'you'])
const rules = [
  { name: 'macOS personal home path', re: new RegExp(String.raw`/Users/(${ACCOUNT})`, 'g') },
  { name: 'Linux personal home path', re: new RegExp(String.raw`/home/(${ACCOUNT})`, 'g') },
  { name: 'Windows personal home path', re: new RegExp(String.raw`\\Users\\(${ACCOUNT})`, 'g') },
  { name: 'GitHub token', re: /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { name: 'API key', re: /(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/g },
  { name: 'private key block', re: /-----BEGIN (?:OPENSSH|RSA|EC|DSA|PGP) PRIVATE KEY-----/g },
  { name: 'bearer literal', re: /Bearer\s+[A-Za-z0-9._-]{24,}/g },
]

function allowedMatch(rule, match) {
  const group = match[1]
  return (rule.name.endsWith('home path')) && group !== undefined && ALLOWED.has(group.toLowerCase())
}

async function files() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const extra = []
  for (const path of ['lib']) {
    try {
      if ((await stat(path)).isDirectory()) {
        const entries = execFileSync('find', [path, '-type', 'f', '-name', '*.js', '-o', '-name', '*.d.ts'], { encoding: 'utf8' })
        extra.push(...entries.split('\n').filter(Boolean))
      }
    } catch {}
  }
  return [...new Set([...tracked, ...extra])]
}

const violations = []
for (const file of await files()) {
  if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.gif') || file.endsWith('.webp')) continue
  let text
  try { text = await readFile(file, 'utf8') } catch { continue }
  const lines = text.split('\n')
  for (const rule of rules) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      rule.re.lastIndex = 0
      for (const match of line.matchAll(rule.re)) {
        if (allowedMatch(rule, match)) continue
        violations.push({ file, line: index + 1, rule: rule.name })
      }
    }
  }
}

if (violations.length > 0) {
  console.error('privacy/secret preflight failed:')
  for (const item of violations.slice(0, 50)) console.error(`- ${item.file}:${item.line} (${item.rule})`)
  if (violations.length > 50) console.error(`... ${violations.length - 50} more`)
  process.exit(1)
}
console.log(`privacy/secret preflight passed (${(await files()).length} files)`)
