# Release Process

Use semantic versioning. v2.0.0 introduces notable behavior and tooling changes.

## Checklist
- Update code and tests
- Update docs (`README.md`, `CHANGELOG.md`, wiki pages)
- Bump `package.json` version
- Commit and tag
- Push commit and tag

## Commands (PowerShell)
```powershell
# After editing package.json and docs
git add -A
git commit -m "chore(release): v2.0.0"
git tag v2.0.0
git push
git push --tags
```

## Changelog Template
```markdown
## [2.0.0] - YYYY-MM-DD
### Added
- ...
### Changed
- ...
### Fixed
- ...
```
