# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# code-style

- Prefer concise, readable code with low line count over verbose abstractions. Confidence: 0.90

# testing

- For test files: Follow the RPS reference test pattern (inline permission/delegate, AnchorProvider.env(), anchor.workspace) rather than the existing cayed test patterns. Confidence: 0.80
- Use `.accounts()` (not `.accountsPartial()`) in test instructions, following the RPS reference pattern. Use `//@ts-ignore` when Anchor account inference needs it. Confidence: 0.65
