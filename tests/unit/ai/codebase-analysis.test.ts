/**
 * Tests for Codebase Analysis Service (#872)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { analyzeCodebase } from '../../../src/ai/codebase-analysis-service.js';

describe('Codebase Analysis Service', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlord-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns error for non-existent directory', () => {
    const result = analyzeCodebase('/nonexistent/path/xyz123');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PATH_NOT_FOUND');
    }
  });

  it('returns error for a file path instead of directory', () => {
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'hello');
    const result = analyzeCodebase(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_DIRECTORY');
    }
  });

  it('detects a Node.js project from package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-app',
      dependencies: { react: '^18.0.0', next: '^14.0.0' },
      devDependencies: { jest: '^29.0.0' },
    }));
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.primaryLanguage).toBe('JavaScript');
      expect(result.data.techStack).toContain('React');
      expect(result.data.techStack).toContain('Node.js');
      expect(result.data.techStack).toContain('TypeScript');
      expect(result.data.techStack).toContain('Jest');
      expect(result.data.testFramework).toBe('Jest');
      expect(result.data.projectType).toBe('web-app');
    }
  });

  it('detects a Rust project from Cargo.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), `
[package]
name = "my-cli"
version = "0.1.0"

[dependencies]
clap = "4.0"
tokio = "1.0"
serde = "1.0"
`);
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.rs'), 'fn main() {}');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.primaryLanguage).toBe('Rust');
      expect(result.data.buildSystem).toBe('cargo');
      expect(result.data.techStack).toContain('Rust');
      expect(result.data.techStack).toContain('Clap');
      expect(result.data.techStack).toContain('Tokio');
      expect(result.data.techStack).toContain('Serde');
      expect(result.data.projectType).toBe('cli-tool');
    }
  });

  it('detects a Python FastAPI project', () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'fastapi\nuvicorn\nsqlalchemy\n');
    fs.writeFileSync(path.join(tmpDir, 'app.py'), '# app');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.primaryLanguage).toBe('Python');
      expect(result.data.framework).toBe('FastAPI');
      expect(result.data.projectType).toBe('api-service');
      expect(result.data.techStack).toContain('FastAPI');
      expect(result.data.techStack).toContain('SQLAlchemy');
    }
  });

  it('detects Docker configuration', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM node:20');
    fs.writeFileSync(path.join(tmpDir, 'docker-compose.yml'), 'version: "3"');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hasDocker).toBe(true);
      expect(result.data.techStack).toContain('Docker');
      expect(result.data.techStack).toContain('Docker Compose');
    }
  });

  it('detects CI/CD from GitHub Actions', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.github', 'workflows', 'ci.yml'), 'name: CI');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hasCICD).toBe(true);
      expect(result.data.techStack).toContain('GitHub Actions');
    }
  });

  it('detects documentation', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# My Project');
    fs.mkdirSync(path.join(tmpDir, 'docs'));
    fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# Guide');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hasDocumentation).toBe(true);
      expect(result.data.documentationPaths).toContain('docs');
      expect(result.data.documentationPaths).toContain('README.md');
    }
  });

  it('detects git repo URL', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.git', 'config'), `
[remote "origin"]
  url = https://github.com/test/repo.git
  fetch = +refs/heads/*:refs/remotes/origin/*
`);

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gitRepoUrl).toBe('https://github.com/test/repo.git');
    }
  });

  it('provides recommended template based on project type', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0' },
    }));

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.recommendedTemplate).toBe('api-service');
      expect(result.data.recommendedRooms.length).toBeGreaterThan(0);
      expect(result.data.recommendedAgents.length).toBeGreaterThan(0);
    }
  });

  it('generates a human-readable summary', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
    }));

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.summary).toBeTruthy();
      expect(result.data.summary.length).toBeGreaterThan(20);
    }
  });

  it('detects Next.js framework from config file', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));
    fs.writeFileSync(path.join(tmpDir, 'next.config.js'), 'module.exports = {}');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.framework).toBe('Next.js');
      expect(result.data.projectType).toBe('web-app');
    }
  });

  it('detects Playwright test framework', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { '@playwright/test': '^1.40.0' },
    }));
    fs.writeFileSync(path.join(tmpDir, 'playwright.config.ts'), '// config');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.testFramework).toBe('Playwright');
      expect(result.data.techStack).toContain('Playwright');
    }
  });

  it('detects a Godot game project', () => {
    fs.writeFileSync(path.join(tmpDir, 'project.godot'), '[gd_scene]');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.framework).toBe('Godot');
      expect(result.data.projectType).toBe('game');
      expect(result.data.recommendedTemplate).toBe('js-game');
    }
  });

  it('detects empty project with no indicators', () => {
    // Just an empty directory
    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.primaryLanguage).toBe('Unknown');
      expect(result.data.projectType).toBe('web-app'); // default
      expect(result.data.maturity).toBe('prototype');
    }
  });

  it('detects microservices pattern from docker-compose + subdirs', () => {
    fs.writeFileSync(path.join(tmpDir, 'docker-compose.yml'), 'version: "3"');
    fs.mkdirSync(path.join(tmpDir, 'service-a'));
    fs.writeFileSync(path.join(tmpDir, 'service-a', 'package.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, 'service-b'));
    fs.writeFileSync(path.join(tmpDir, 'service-b', 'package.json'), '{}');

    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.projectType).toBe('microservices');
    }
  });

  it('uses directory name as project name', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    const result = analyzeCodebase(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.projectName).toBeTruthy();
      // tmpDir has a random suffix, but basename should be non-empty
      expect(result.data.projectName.length).toBeGreaterThan(0);
    }
  });
});
