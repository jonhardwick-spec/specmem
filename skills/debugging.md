# Debugging Skill

Tags: debug, troubleshoot, fix, errors

## Purpose
Systematically debug issues in code, identify root causes, and provide solutions.

## Debugging Process

### Step 1: Understand the Problem
- What is the expected behavior?
- What is the actual behavior?
- When did it start happening?
- What changed recently?

### Step 2: Reproduce the Issue
- Can you reliably reproduce it?
- What are the exact steps?
- What environment/conditions trigger it?

### Step 3: Gather Information
- Check error messages and stack traces
- Review relevant logs
- Identify the affected code paths
- Check input data

### Step 4: Form Hypotheses
- What could cause this behavior?
- List potential root causes
- Prioritize by likelihood

### Step 5: Test Hypotheses
- Add logging/breakpoints
- Test each hypothesis
- Eliminate unlikely causes

### Step 6: Fix and Verify
- Implement the fix
- Test the fix thoroughly
- Ensure no regressions

## Common Debugging Techniques

1. **Binary Search**: Comment out half the code, narrow down
2. **Rubber Duck**: Explain the problem out loud
3. **Print Debugging**: Add strategic console.log statements
4. **Diff Analysis**: What changed between working and broken?
5. **Minimal Reproduction**: Create smallest failing example

## Response Format

When debugging, provide:
1. **Problem Summary**: What's broken
2. **Root Cause**: Why it's broken
3. **Solution**: How to fix it
4. **Prevention**: How to avoid similar issues
