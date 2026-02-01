const lemmatize = require('wink-lemmatizer');

const tests = [
  'working', 'worked', 'works', 'worker',
  'running', 'ran', 'runs',
  'created', 'creates', 'creating',
  'stopped', 'stopping',
  'written', 'wrote', 'writes',
  'children', 'mice',
  'happiness', 'happily',
  'bigger', 'biggest'
];

console.log('wink-lemmatizer results:\n');
for (const t of tests) {
  const v = lemmatize.verb(t);
  const n = lemmatize.noun(t);
  const a = lemmatize.adjective(t);
  console.log(`${t.padEnd(12)} → verb:${v.padEnd(8)} noun:${n.padEnd(8)} adj:${a}`);
}
