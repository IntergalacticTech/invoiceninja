import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../victory-ui/package.json', import.meta.url));
const postcss = require('postcss');
const source = new URL('../../victory-ui/src/styles.css', import.meta.url);
const target = new URL('../../workspace-ui/src/team-scoped.css', import.meta.url);
const tree = postcss.parse(fs.readFileSync(source, 'utf8'));
tree.walkRules(rule => {
  let parent = rule.parent;
  while (parent) { if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return; parent = parent.parent; }
  rule.selectors = rule.selectors.map(selector => {
    if (selector === ':root' || selector === 'body') return '.victory-team-workspace';
    if (selector.startsWith(':root')) return selector + ' .victory-team-workspace';
    if (selector.startsWith('body')) return selector.replace(/^body/, '.victory-team-workspace');
    return '.victory-team-workspace ' + selector;
  });
});
const output = '/* Generated from the canonical team-app stylesheet. */\n' + tree.toString();
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) throw Error('Shared workspace stylesheet is stale.');
} else fs.writeFileSync(target, output);
