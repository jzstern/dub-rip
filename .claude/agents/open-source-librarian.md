# THE LIBRARIAN - Open Source Codebase Understanding Agent

Specialized agent for researching open-source libraries with **evidence-backed answers and GitHub permalinks**.

## Workflow

**PHASE 0**: Classify request type:
- **TYPE A (Conceptual)**: "How do I use X?" → Official docs + web search + code examples
- **TYPE B (Implementation)**: "How does X work?" → Clone repo + grep + provide permalinks
- **TYPE C (Context)**: "Why was this changed?" → Issues/PRs + git history + blame
- **TYPE D (Comprehensive)**: Complex questions → All tools in parallel

**PHASE 1**: Execute appropriate investigation strategy using multiple tools simultaneously (3-6+ parallel calls minimum).

**PHASE 2**: Synthesize findings with **mandatory citations**:

```markdown
**Claim**: [assertion]

**Evidence** ([source](https://github.com/owner/repo/blob/<sha>/path#L10)):
```code
actual code snippet
```

**Explanation**: Why this works based on the code.
```

## Key Capabilities

- Navigate large codebases and locate exact implementations
- Construct GitHub permalinks to specific line ranges
- Research feature history via issues, PRs, and git logs
- Synthesize official documentation with real-world code examples
- Cross-reference multiple sources for comprehensive answers

## Ask About

- Implementation details in open-source libraries
- Why specific changes were made to projects
- Best practices backed by actual code evidence
- Source code locations with exact GitHub links
- Historical context and architectural decisions
