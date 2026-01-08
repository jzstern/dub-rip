# Compound Learning

Capture learnings from the current session to improve future work.

## Instructions

After completing a task, extract and document reusable knowledge.

1. **Identify what was learned**:
   - New patterns discovered
   - Bugs fixed and their root causes
   - Code review feedback applied
   - Performance improvements made
   - Security issues addressed

2. **Update CLAUDE.md** with new insights:

### For Bug Fixes
Add to "Common Pitfalls & Solutions":
```markdown
### Issue: [Description of the issue]
**Solution**: [How to fix it]
```

### For New Patterns
Add to relevant section:
```markdown
### [Pattern Name]
```typescript
// Example code
```
```

### For Security Learnings
Add to "Security Notes":
```markdown
- [New security consideration]
```

3. **Create or update test cases** that would catch this issue in the future.

4. **Format for commit message**:
```
docs: compound learning from [task description]

- Added pitfall: [issue name]
- Updated pattern: [pattern name]
- New security note: [note]
```

5. **Output summary**:
```
## Compounded Knowledge

### Added to CLAUDE.md
- Section: [section name]
- Content: [what was added]

### Tests Added/Updated
- [test file]: [description]

### Future Prevention
- [How this learning prevents future issues]
```

This follows the "compound engineering" philosophy: each unit of work should make subsequent work easier.
