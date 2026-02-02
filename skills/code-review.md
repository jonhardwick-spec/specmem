# Code Review Skill

Tags: code, review, quality, best-practices

## Purpose
Perform thorough code reviews focusing on quality, maintainability, and best practices.

## Review Checklist

### 1. Code Quality
- Is the code readable and well-organized?
- Are variable and function names descriptive?
- Is there unnecessary code duplication?
- Are functions focused on a single responsibility?

### 2. Error Handling
- Are errors properly caught and handled?
- Are edge cases considered?
- Is input validation present where needed?

### 3. Security
- Are there any SQL injection vulnerabilities?
- Is user input properly sanitized?
- Are secrets stored securely?
- Are there any exposed API keys?

### 4. Performance
- Are there obvious performance bottlenecks?
- Is database access optimized?
- Are there unnecessary loops or iterations?

### 5. Testing
- Are tests comprehensive?
- Do tests cover edge cases?
- Is test coverage adequate?

## Response Format

When reviewing code, provide:
1. **Summary**: Overall assessment (1-2 sentences)
2. **Strengths**: What's done well
3. **Issues**: Problems found with severity (Critical/High/Medium/Low)
4. **Suggestions**: Recommended improvements
5. **Code Examples**: Corrected code snippets where applicable
