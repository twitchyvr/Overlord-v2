# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | Yes                |
| < 1.0   | No                 |

## Reporting a Vulnerability

If you discover a security vulnerability in Overlord v2, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. **GitHub Private Vulnerability Reporting** (preferred): Use the "Report a vulnerability" button on the [Security tab](https://github.com/twitchyvr/Overlord-v2/security/advisories/new)
2. **Email**: Send details to **overlord@twitchyvr.com**

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Fix Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release cycle

### What to Expect

- We will acknowledge your report promptly
- We will keep you informed of progress
- We will credit you in the security advisory (unless you prefer anonymity)
- We will not take legal action against good-faith security researchers

## Security Best Practices for Contributors

- Never commit API keys, tokens, or credentials
- Use environment variables for all secrets
- Validate all user input at system boundaries
- Follow OWASP Top 10 guidelines
- Run `npm audit` before submitting PRs

## Known Security Considerations

Overlord v2 executes AI agent tool calls that may include file system access and shell commands. The security model includes:

- **File scope restrictions**: Agents can only access files within their building's working directory
- **Tool allowlists**: Each room defines which tools agents can use
- **Security levels**: Buildings can be configured with different security levels
- **Shell guards**: Plugin-based shell command validation
- **Secret scanning**: Plugin-based detection of credentials in code
