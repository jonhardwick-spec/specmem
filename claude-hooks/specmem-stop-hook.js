#!/usr/bin/env node
// ESM wrapper - delegates to CJS version
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('./specmem-stop-hook.cjs');
