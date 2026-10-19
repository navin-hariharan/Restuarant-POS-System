// Builds server/lang/en.json: every text the app can show in English, keyed
// by itself. Keys come from t('...') calls in the web app and from
// t("...") / tp("...") / field(..., "...") calls in the server.
// Other languages are edited in Settings > Languages and keep their own
// values; missing keys fall back to English.
// Run: node scripts/i18n-keys.mjs   (also runs before `npm run build`)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const server = join(web, '..', 'server');

const walk = (d, ext, out = []) => {
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};

const keys = new Set();
const unescape = (s) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

// Web app: t('...') / t("...") and nav labels translated through t(item.label)
const tCall = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
for (const f of walk(join(web, 'src'), /\.(ts|tsx)$/)) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(tCall)) keys.add(unescape(m[2]));
  if (/nav\.tsx$/.test(f)) for (const m of src.matchAll(/label:\s*'([^']+)'/g)) keys.add(m[1]);
}

// Server: state.t("..."), state.tp("...", ..), tr!("...") and the message
// argument of AppError::field / Errors::add when it is a literal
const S = '"((?:\\\\.|[^"\\\\])*)"';
const rsCalls = [
  new RegExp(`\\.tp?\\(\\s*${S}`, 'g'),
  new RegExp(`\\btr!\\(\\s*${S}`, 'g'),
  new RegExp(`AppError::(?:bad_request|forbidden|not_acceptable|conflict|unprocessable)\\(\\s*${S}`, 'g'),
  new RegExp(`AppError::field\\([^,]+,\\s*${S}`, 'g'),
  new RegExp(`\\.add\\(\\s*"[^"]*",\\s*${S}`, 'g'),
];
for (const f of walk(join(server, 'src'), /\.rs$/)) {
  const src = readFileSync(f, 'utf8');
  for (const re of rsCalls) for (const m of src.matchAll(re)) keys.add(unescape(m[1]));
}

const out = join(server, 'lang', 'en.json');
mkdirSync(dirname(out), { recursive: true });
const sorted = Object.fromEntries(
  [...keys].filter((k) => k.trim() !== '').sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b)).map((k) => [k, k]),
);
writeFileSync(out, JSON.stringify(sorted, null, 2) + '\n');
console.log(`i18n: ${Object.keys(sorted).length} keys written to server/lang/en.json`);
