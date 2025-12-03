#!/usr/bin/env node
// Archive staged .html files before commit by copying them into html-archive/
// with a timestamped filename. Intended to be called from a git pre-commit hook.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function nowTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

function run() {
  try {
    // Get staged files (Added, Copied, Modified)
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    if (!out) return 0;
    const files = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const htmlFiles = files.filter(f => f.toLowerCase().endsWith('.html'));
    if (htmlFiles.length === 0) return 0;

    const archiveRoot = path.resolve(__dirname, '..', 'html-archive');
    if (!fs.existsSync(archiveRoot)) fs.mkdirSync(archiveRoot, { recursive: true });

    const ts = nowTs();
    htmlFiles.forEach(f => {
      try {
        const src = path.resolve(process.cwd(), f);
        if (!fs.existsSync(src)) return;
        // Create a safe filename preserving path components replaced with '__'
        const safe = f.replace(/\\/g, '/').replace(/[^a-zA-Z0-9._\/-]/g, '_').replace(/\//g, '__');
        const dest = path.join(archiveRoot, `${ts}__${safe}`);
        fs.copyFileSync(src, dest);
        console.log(`[archive-html] saved ${f} -> ${path.relative(process.cwd(), dest)}`);
      } catch (e) {
        console.warn('[archive-html] failed to archive', f, e && e.message);
      }
    });
    return 0;
  } catch (e) {
    // Do not fail the commit if the archiver fails; warn instead.
    console.warn('[archive-html] hook failed:', e && e.message);
    return 0;
  }
}

if (require.main === module) process.exit(run());
