#!/usr/bin/env node
/**
 * Strip all console.log('[*DEBUG]' statements from source files
 * This fixes the MCP protocol pollution issue
 */

const fs = require('fs');
const path = require('path');

const filesToFix = [
  'src/tools/goofy/findWhatISaid.ts',
  'src/utils/qoms.ts',
  'src/index.ts',
  'src/mcp/toolRegistry.ts',
  'src/mcp/specMemServer.ts',
  'src/mcp/mcpProtocolHandler.ts'
];

const basePath = '/specmem';

for (const file of filesToFix) {
  const fullPath = path.join(basePath, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`Skipping ${file} - not found`);
    continue;
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  const original = content;
  
  // Comment out console.log('[* DEBUG]' lines
  content = content.replace(/^(\s*)(console\.log\s*\(\s*\['\w*\s*DEBUG'\])/gm, '$1// DISABLED: $2');
  
  if (content !== original) {
    fs.writeFileSync(fullPath, content);
    const commented = (content.match(/\/\/ DISABLED: console\.log/g) || []).length;
    console.log(`Fixed ${file}: commented ${commented} debug logs`);
  } else {
    console.log(`${file}: no changes needed`);
  }
}

console.log('Done! Rebuild with: npm run build');
