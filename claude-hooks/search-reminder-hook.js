#!/usr/bin/env node
/**
 * Search Reminder Hook
 * ====================
 *
 * PreToolUse hook that injects a Traditional Chinese compressed reminder
 * when  uses Grep/Glob tools, suggesting find_code_pointers instead.
 *
 * Hook Event: PreToolUse
 * Matcher: Grep, Glob
 */

/**
 * Read stdin with timeout
 */
function readStdinWithTimeout(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let input = '';
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve(input);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(input);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(input);
    });
  });
}

/**
 * Compact Traditional Chinese reminder for find_code_pointers
 *  understands Chinese internally, outputs English
 */
function getSearchReminder() {
  return `
[SM-搜索提示] ⚠️壓縮-內部理解中文,輸出英文
考慮用 find_code_pointers 代替 Grep/Glob:

🔍 **find_code_pointers** - 語義碼搜 + 追蹤調用者
   - zoom=0: 簽名only (概覽)
   - zoom=50: 平衡 (默認)
   - zoom=100: 全上下文
   - includeTracebacks=true: 顯示誰調用此碼
   - cameraRollMode=true: 返回drilldownIDs可深入探索

💡 用例:
   - "找認證函數" → find_code_pointers({query:"authentication"})
   - "追蹤API調用" → find_code_pointers({query:"API endpoint", includeTracebacks:true})
   - "快速概覽" → find_code_pointers({query:"...", zoom:0, limit:20})

Grep/Glob適合精確模式匹配. find_code_pointers適合理解代碼意圖.
[/SM-搜索提示]`;
}

async function main() {
  const inputData = await readStdinWithTimeout(3000);

  try {
    const hookData = JSON.parse(inputData);
    const toolName = hookData.tool_name || '';

    // Only trigger on Grep/Glob
    if (!['Grep', 'Glob'].includes(toolName)) {
      process.exit(0);
    }

    // Inject reminder as additionalContext (doesn't block, just adds context)
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: getSearchReminder()
      }
    }));

    process.exit(0);

  } catch (error) {
    // On error, pass through silently
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
