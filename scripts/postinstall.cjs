#!/usr/bin/env node
/**
 * SpecMem Post-Install Warning
 * Shows root requirement notice
 * Hardwick Software Services
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m'
};

function rainbow(text) {
  const rainbowColors = ['\x1b[31m', '\x1b[33m', '\x1b[32m', '\x1b[36m', '\x1b[34m', '\x1b[35m'];
  let result = '';
  let colorIdx = 0;
  for (const char of text) {
    if (char === ' ') {
      result += char;
    } else {
      result += rainbowColors[colorIdx % rainbowColors.length] + char;
      colorIdx++;
    }
  }
  return result + '\x1b[0m';
}

console.log('\n' + rainbow('════════════════════════════════════════════════════════════════'));
console.log(rainbow('                    SPECMEM INSTALLED!                           '));
console.log(rainbow('════════════════════════════════════════════════════════════════') + '\n');

console.log(`${colors.yellow}${colors.bright}⚠️  ROOT REQUIREMENT NOTICE${colors.reset}\n`);

console.log(`${colors.cyan}We require root because we do a lot of stuff with dockers and`);
console.log(`spawn mini LLMs to make sure Claude remembers.${colors.reset}\n`);

console.log(`${colors.green}Sorry not sorry - we promise to never push dirty code,`);
console.log(`but we do need you to use root!${colors.reset}\n`);

console.log(`${colors.magenta}Can't use root? (We're working on it, hang tight!)${colors.reset}\n`);

console.log(`${colors.dim}────────────────────────────────────────────────────────────────${colors.reset}`);
console.log(`${colors.cyan}Get started:${colors.reset}`);
console.log(`  ${colors.green}specmem init${colors.reset}    - Initialize SpecMem in current project`);
console.log(`  ${colors.green}specmem setup${colors.reset}   - Full setup wizard`);
console.log(`  ${colors.green}specmem help${colors.reset}    - Show all commands`);
console.log(`${colors.dim}────────────────────────────────────────────────────────────────${colors.reset}`);
console.log(`${colors.cyan}Hardwick Software Services${colors.reset} - ${colors.magenta}https://justcalljon.pro${colors.reset}\n`);
