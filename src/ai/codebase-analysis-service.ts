/**
 * Codebase Analysis Service — Local Directory Analysis
 *
 * Scans a local directory to detect project type, language, framework,
 * tooling, maturity, and recommends Overlord building configuration.
 *
 * Layer: AI (imports only from Core)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, AIProviderAPI } from '../core/contracts.js';

const log = logger.child({ module: 'ai:codebase-analysis' });

// ─── Types ───

export interface CodebaseAnalysisResult {
  projectName: string;
  projectType: string;
  primaryLanguage: string;
  framework: string | null;
  buildSystem: string | null;
  testFramework: string | null;
  hasDocker: boolean;
  hasCICD: boolean;
  hasDocumentation: boolean;
  maturity: 'prototype' | 'mvp' | 'production' | 'legacy';
  detectedFiles: DetectedFile[];
  techStack: string[];
  documentationPaths: string[];
  gitRepoUrl: string | null;
  recommendedTemplate: string;
  recommendedRooms: RecommendedRoom[];
  recommendedAgents: RecommendedAgent[];
  summary: string;
}

export interface DetectedFile {
  path: string;
  indicator: string;
}

export interface RecommendedRoom {
  type: string;
  floor: string;
  name: string;
}

export interface RecommendedAgent {
  name: string;
  role: string;
  capabilities: string[];
  roomAccess: string[];
}

// ─── Indicator File Map ───

interface IndicatorMatch {
  language: string;
  framework?: string;
  projectType?: string;
  buildSystem?: string;
  testFramework?: string;
  techStack: string[];
}

const INDICATOR_FILES: Record<string, IndicatorMatch> = {
  'package.json': { language: 'JavaScript', buildSystem: 'npm', techStack: ['Node.js'] },
  'tsconfig.json': { language: 'TypeScript', techStack: ['TypeScript'] },
  'Cargo.toml': { language: 'Rust', buildSystem: 'cargo', techStack: ['Rust'] },
  'go.mod': { language: 'Go', buildSystem: 'go', techStack: ['Go'] },
  'requirements.txt': { language: 'Python', buildSystem: 'pip', techStack: ['Python'] },
  'setup.py': { language: 'Python', buildSystem: 'pip', techStack: ['Python'] },
  'pyproject.toml': { language: 'Python', buildSystem: 'pip', techStack: ['Python'] },
  'Pipfile': { language: 'Python', buildSystem: 'pipenv', techStack: ['Python', 'Pipenv'] },
  'poetry.lock': { language: 'Python', buildSystem: 'poetry', techStack: ['Python', 'Poetry'] },
  'pom.xml': { language: 'Java', buildSystem: 'maven', techStack: ['Java', 'Maven'] },
  'build.gradle': { language: 'Java', buildSystem: 'gradle', techStack: ['Java', 'Gradle'] },
  'build.gradle.kts': { language: 'Kotlin', buildSystem: 'gradle', techStack: ['Kotlin', 'Gradle'] },
  'CMakeLists.txt': { language: 'C++', buildSystem: 'cmake', techStack: ['C++', 'CMake'] },
  'Makefile': { language: 'C', buildSystem: 'make', techStack: ['Make'] },
  'Gemfile': { language: 'Ruby', buildSystem: 'bundler', techStack: ['Ruby'] },
  'pubspec.yaml': { language: 'Dart', framework: 'Flutter', projectType: 'mobile', techStack: ['Dart', 'Flutter'] },
  'project.godot': { language: 'GDScript', framework: 'Godot', projectType: 'game', techStack: ['Godot'] },
  'Dockerfile': { language: '', techStack: ['Docker'] },
  'docker-compose.yml': { language: '', techStack: ['Docker Compose'] },
  'docker-compose.yaml': { language: '', techStack: ['Docker Compose'] },

  // Framework-specific
  'next.config.js': { language: 'JavaScript', framework: 'Next.js', projectType: 'web-app', techStack: ['Next.js', 'React'] },
  'next.config.mjs': { language: 'JavaScript', framework: 'Next.js', projectType: 'web-app', techStack: ['Next.js', 'React'] },
  'next.config.ts': { language: 'TypeScript', framework: 'Next.js', projectType: 'web-app', techStack: ['Next.js', 'React'] },
  'nuxt.config.ts': { language: 'TypeScript', framework: 'Nuxt', projectType: 'web-app', techStack: ['Nuxt', 'Vue'] },
  'nuxt.config.js': { language: 'JavaScript', framework: 'Nuxt', projectType: 'web-app', techStack: ['Nuxt', 'Vue'] },
  'vite.config.ts': { language: 'TypeScript', framework: 'Vite', projectType: 'web-app', techStack: ['Vite'] },
  'vite.config.js': { language: 'JavaScript', framework: 'Vite', projectType: 'web-app', techStack: ['Vite'] },
  'angular.json': { language: 'TypeScript', framework: 'Angular', projectType: 'web-app', techStack: ['Angular'] },
  'svelte.config.js': { language: 'JavaScript', framework: 'SvelteKit', projectType: 'web-app', techStack: ['Svelte'] },
  'remix.config.js': { language: 'JavaScript', framework: 'Remix', projectType: 'web-app', techStack: ['Remix', 'React'] },
  'astro.config.mjs': { language: 'JavaScript', framework: 'Astro', projectType: 'web-app', techStack: ['Astro'] },
  'tailwind.config.js': { language: '', techStack: ['Tailwind CSS'] },
  'tailwind.config.ts': { language: '', techStack: ['Tailwind CSS'] },
  'postcss.config.js': { language: '', techStack: ['PostCSS'] },

  // Test frameworks
  'jest.config.js': { language: 'JavaScript', testFramework: 'Jest', techStack: ['Jest'] },
  'jest.config.ts': { language: 'TypeScript', testFramework: 'Jest', techStack: ['Jest'] },
  'vitest.config.ts': { language: 'TypeScript', testFramework: 'Vitest', techStack: ['Vitest'] },
  'playwright.config.ts': { language: 'TypeScript', testFramework: 'Playwright', techStack: ['Playwright'] },
  'cypress.config.ts': { language: 'TypeScript', testFramework: 'Cypress', techStack: ['Cypress'] },
  'cypress.config.js': { language: 'JavaScript', testFramework: 'Cypress', techStack: ['Cypress'] },
  'pytest.ini': { language: 'Python', testFramework: 'pytest', techStack: ['pytest'] },
  '.mocharc.yml': { language: 'JavaScript', testFramework: 'Mocha', techStack: ['Mocha'] },

  // C# / .NET / Unity
  '*.sln': { language: 'C#', buildSystem: 'dotnet', techStack: ['C#', '.NET'] },
  '*.csproj': { language: 'C#', buildSystem: 'dotnet', techStack: ['C#', '.NET'] },

  // CI/CD
  '.github/workflows': { language: '', techStack: ['GitHub Actions'] },
  'Jenkinsfile': { language: '', techStack: ['Jenkins'] },
  '.gitlab-ci.yml': { language: '', techStack: ['GitLab CI'] },
  '.circleci/config.yml': { language: '', techStack: ['CircleCI'] },

  // Python web frameworks
  'manage.py': { language: 'Python', framework: 'Django', projectType: 'web-app', techStack: ['Django'] },
  'app.py': { language: 'Python', techStack: ['Python'] },

  // Unreal Engine
  '*.uproject': { language: 'C++', framework: 'Unreal Engine', projectType: 'game', techStack: ['Unreal Engine', 'C++'] },
};

// ─── Package.json Deep Inspection ───

interface PackageJsonHints {
  framework?: string;
  projectType?: string;
  testFramework?: string;
  techStack: string[];
  hasScripts: boolean;
  scriptCount: number;
}

function inspectPackageJson(dir: string): PackageJsonHints | null {
  const pkgPath = path.join(dir, 'package.json');
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
    const scripts = pkg.scripts as Record<string, string> || {};
    const hints: PackageJsonHints = { techStack: [], hasScripts: Object.keys(scripts).length > 0, scriptCount: Object.keys(scripts).length };

    // React
    if (deps.react) { hints.techStack.push('React'); hints.framework = hints.framework || 'React'; hints.projectType = 'web-app'; }
    if (deps['react-native']) { hints.techStack.push('React Native'); hints.framework = 'React Native'; hints.projectType = 'mobile'; }
    if (deps.vue) { hints.techStack.push('Vue'); hints.framework = hints.framework || 'Vue'; hints.projectType = 'web-app'; }
    if (deps.svelte) { hints.techStack.push('Svelte'); hints.framework = hints.framework || 'Svelte'; hints.projectType = 'web-app'; }
    if (deps.express) { hints.techStack.push('Express'); hints.projectType = hints.projectType || 'api-service'; }
    if (deps.fastify) { hints.techStack.push('Fastify'); hints.projectType = hints.projectType || 'api-service'; }
    if (deps.koa) { hints.techStack.push('Koa'); hints.projectType = hints.projectType || 'api-service'; }
    if (deps.hono) { hints.techStack.push('Hono'); hints.projectType = hints.projectType || 'api-service'; }
    if (deps.electron) { hints.techStack.push('Electron'); hints.projectType = 'desktop'; }
    if (deps.phaser) { hints.techStack.push('Phaser'); hints.projectType = 'js-game'; hints.framework = 'Phaser'; }
    if (deps['three']) { hints.techStack.push('Three.js'); }
    if (deps.prisma || deps['@prisma/client']) { hints.techStack.push('Prisma'); }
    if (deps.mongoose) { hints.techStack.push('Mongoose', 'MongoDB'); }
    if (deps.sequelize) { hints.techStack.push('Sequelize'); }
    if (deps.drizzle || deps['drizzle-orm']) { hints.techStack.push('Drizzle'); }
    if (deps.socket || deps['socket.io']) { hints.techStack.push('Socket.IO'); }
    if (deps.graphql || deps['@apollo/server'] || deps['apollo-server']) { hints.techStack.push('GraphQL'); }
    if (deps.stripe || deps['@stripe/stripe-js']) { hints.techStack.push('Stripe'); }
    if (deps['@supabase/supabase-js']) { hints.techStack.push('Supabase'); }
    if (deps.firebase || deps['firebase-admin']) { hints.techStack.push('Firebase'); }

    // Test frameworks from deps
    if (deps.jest || deps['@jest/core']) { hints.testFramework = 'Jest'; hints.techStack.push('Jest'); }
    if (deps.vitest) { hints.testFramework = 'Vitest'; hints.techStack.push('Vitest'); }
    if (deps.playwright || deps['@playwright/test']) { hints.testFramework = hints.testFramework || 'Playwright'; hints.techStack.push('Playwright'); }
    if (deps.mocha) { hints.testFramework = hints.testFramework || 'Mocha'; hints.techStack.push('Mocha'); }

    // CLI tool detection
    if (pkg.bin) { hints.projectType = hints.projectType || 'cli-tool'; }

    return hints;
  } catch {
    return null;
  }
}

// ─── Cargo.toml Inspection ───

function inspectCargoToml(dir: string): { projectType?: string; techStack: string[] } | null {
  const cargoPath = path.join(dir, 'Cargo.toml');
  try {
    const raw = fs.readFileSync(cargoPath, 'utf-8');
    const techStack: string[] = [];
    let projectType: string | undefined;

    if (raw.includes('actix-web') || raw.includes('axum') || raw.includes('rocket')) {
      techStack.push(raw.includes('actix-web') ? 'Actix' : raw.includes('axum') ? 'Axum' : 'Rocket');
      projectType = 'api-service';
    }
    if (raw.includes('[[bin]]') || (raw.includes('[dependencies]') && raw.includes('clap'))) {
      projectType = projectType || 'cli-tool';
      if (raw.includes('clap')) techStack.push('Clap');
    }
    if (fs.existsSync(path.join(dir, 'src', 'lib.rs')) && !fs.existsSync(path.join(dir, 'src', 'main.rs'))) {
      projectType = 'library';
    }
    if (raw.includes('bevy')) { techStack.push('Bevy'); projectType = 'game'; }
    if (raw.includes('tokio')) techStack.push('Tokio');
    if (raw.includes('serde')) techStack.push('Serde');

    return { projectType, techStack };
  } catch {
    return null;
  }
}

// ─── Python Project Inspection ───

function inspectPythonProject(dir: string): { framework?: string; projectType?: string; techStack: string[] } | null {
  const hints: { framework?: string; projectType?: string; techStack: string[] } = { techStack: [] };
  try {
    // Check requirements.txt
    const reqPath = path.join(dir, 'requirements.txt');
    let raw = '';
    if (fs.existsSync(reqPath)) raw = fs.readFileSync(reqPath, 'utf-8');

    // Check pyproject.toml
    const pyprojectPath = path.join(dir, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) raw += '\n' + fs.readFileSync(pyprojectPath, 'utf-8');

    if (raw.includes('fastapi')) { hints.framework = 'FastAPI'; hints.projectType = 'api-service'; hints.techStack.push('FastAPI'); }
    if (raw.includes('django')) { hints.framework = 'Django'; hints.projectType = 'web-app'; hints.techStack.push('Django'); }
    if (raw.includes('flask')) { hints.framework = 'Flask'; hints.projectType = 'web-app'; hints.techStack.push('Flask'); }
    if (raw.includes('streamlit')) { hints.framework = 'Streamlit'; hints.projectType = 'data-pipeline'; hints.techStack.push('Streamlit'); }
    if (raw.includes('pandas')) hints.techStack.push('Pandas');
    if (raw.includes('numpy')) hints.techStack.push('NumPy');
    if (raw.includes('tensorflow') || raw.includes('torch')) {
      hints.techStack.push(raw.includes('tensorflow') ? 'TensorFlow' : 'PyTorch');
      hints.projectType = hints.projectType || 'data-pipeline';
    }
    if (raw.includes('pytest')) hints.techStack.push('pytest');
    if (raw.includes('celery')) hints.techStack.push('Celery');
    if (raw.includes('sqlalchemy')) hints.techStack.push('SQLAlchemy');

    return hints.techStack.length > 0 ? hints : null;
  } catch {
    return null;
  }
}

// ─── Git URL Detection ───

function detectGitUrl(dir: string): string | null {
  const configPath = path.join(dir, '.git', 'config');
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const match = raw.match(/url\s*=\s*(.+)/);
    if (match) return match[1].trim();
    return null;
  } catch {
    return null;
  }
}

// ─── Maturity Detection ───

function detectMaturity(dir: string, hasTests: boolean, hasCICD: boolean, hasDocs: boolean): CodebaseAnalysisResult['maturity'] {
  let score = 0;
  if (hasTests) score += 2;
  if (hasCICD) score += 2;
  if (hasDocs) score += 1;
  if (fs.existsSync(path.join(dir, 'CHANGELOG.md'))) score += 1;
  if (fs.existsSync(path.join(dir, 'CONTRIBUTING.md'))) score += 1;
  if (fs.existsSync(path.join(dir, 'LICENSE'))) score += 1;

  // Check for releases/tags
  try {
    const tags = fs.readdirSync(path.join(dir, '.git', 'refs', 'tags'));
    if (tags.length > 0) score += 2;
  } catch { /* no tags */ }

  if (score >= 7) return 'production';
  if (score >= 4) return 'mvp';
  if (score >= 1) return 'prototype';
  return 'prototype';
}

// ─── Template Recommendation ───

interface TemplateRecommendation {
  templateId: string;
  rooms: RecommendedRoom[];
  agents: RecommendedAgent[];
}

function recommendTemplate(projectType: string, _language: string): TemplateRecommendation {
  const RECOMMENDATIONS: Record<string, TemplateRecommendation> = {
    'web-app': {
      templateId: 'web-app',
      rooms: [
        { type: 'strategist', floor: 'strategy', name: 'Strategist Office' },
        { type: 'discovery', floor: 'collaboration', name: 'Discovery Room' },
        { type: 'architecture', floor: 'collaboration', name: 'Architecture Studio' },
        { type: 'code-lab', floor: 'execution', name: 'Frontend Lab' },
        { type: 'code-lab', floor: 'execution', name: 'Backend Lab' },
        { type: 'testing-lab', floor: 'execution', name: 'Testing Lab' },
        { type: 'review', floor: 'governance', name: 'Review Chamber' },
        { type: 'deploy', floor: 'operations', name: 'Deploy Control' },
      ],
      agents: [
        { name: 'Strategist', role: 'strategist', capabilities: ['chat', 'analysis'], roomAccess: ['strategist', 'discovery'] },
        { name: 'Architect', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture', 'discovery'] },
        { name: 'Frontend Dev', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'Backend Dev', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'QA Engineer', role: 'tester', capabilities: ['chat', 'testing', 'analysis'], roomAccess: ['testing-lab'] },
        { name: 'Reviewer', role: 'reviewer', capabilities: ['chat', 'review', 'analysis'], roomAccess: ['review'] },
        { name: 'DevOps', role: 'devops', capabilities: ['chat', 'deploy'], roomAccess: ['deploy'] },
      ],
    },
    'api-service': {
      templateId: 'api-service',
      rooms: [
        { type: 'strategist', floor: 'strategy', name: 'Strategist Office' },
        { type: 'discovery', floor: 'collaboration', name: 'Discovery Room' },
        { type: 'architecture', floor: 'collaboration', name: 'API Architecture' },
        { type: 'code-lab', floor: 'execution', name: 'API Lab' },
        { type: 'testing-lab', floor: 'execution', name: 'Testing Lab' },
        { type: 'review', floor: 'governance', name: 'Review Chamber' },
        { type: 'deploy', floor: 'operations', name: 'Deploy Control' },
      ],
      agents: [
        { name: 'Strategist', role: 'strategist', capabilities: ['chat', 'analysis'], roomAccess: ['strategist', 'discovery'] },
        { name: 'API Architect', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture', 'discovery'] },
        { name: 'Backend Dev', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'API Reviewer', role: 'reviewer', capabilities: ['chat', 'review', 'analysis'], roomAccess: ['review'] },
        { name: 'DevOps', role: 'devops', capabilities: ['chat', 'deploy'], roomAccess: ['deploy'] },
      ],
    },
    'cli-tool': {
      templateId: 'cli-tool',
      rooms: [
        { type: 'strategist', floor: 'strategy', name: 'Strategist Office' },
        { type: 'discovery', floor: 'collaboration', name: 'Discovery Room' },
        { type: 'architecture', floor: 'collaboration', name: 'Architecture Studio' },
        { type: 'code-lab', floor: 'execution', name: 'Code Lab' },
        { type: 'testing-lab', floor: 'execution', name: 'Testing Lab' },
        { type: 'review', floor: 'governance', name: 'Review Chamber' },
      ],
      agents: [
        { name: 'Strategist', role: 'strategist', capabilities: ['chat', 'analysis'], roomAccess: ['strategist', 'discovery'] },
        { name: 'CLI Architect', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture', 'discovery'] },
        { name: 'Developer', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'Reviewer', role: 'reviewer', capabilities: ['chat', 'review', 'analysis'], roomAccess: ['review'] },
      ],
    },
    'game': {
      templateId: 'js-game',
      rooms: [
        { type: 'strategist', floor: 'strategy', name: 'Strategist Office' },
        { type: 'discovery', floor: 'collaboration', name: 'Game Design Room' },
        { type: 'architecture', floor: 'collaboration', name: 'Architecture Studio' },
        { type: 'code-lab', floor: 'execution', name: 'Gameplay Lab' },
        { type: 'code-lab', floor: 'execution', name: 'Engine Lab' },
        { type: 'testing-lab', floor: 'execution', name: 'QA Lab' },
        { type: 'review', floor: 'governance', name: 'Review Chamber' },
      ],
      agents: [
        { name: 'Strategist', role: 'strategist', capabilities: ['chat', 'analysis'], roomAccess: ['strategist', 'discovery'] },
        { name: 'Game Designer', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture', 'discovery'] },
        { name: 'Gameplay Dev', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'Systems Dev', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'QA Tester', role: 'tester', capabilities: ['chat', 'testing', 'analysis'], roomAccess: ['testing-lab'] },
        { name: 'Reviewer', role: 'reviewer', capabilities: ['chat', 'review', 'analysis'], roomAccess: ['review'] },
      ],
    },
    'data-pipeline': {
      templateId: 'data-pipeline',
      rooms: [
        { type: 'strategist', floor: 'strategy', name: 'Strategist Office' },
        { type: 'discovery', floor: 'collaboration', name: 'Discovery Room' },
        { type: 'architecture', floor: 'collaboration', name: 'Data Architecture' },
        { type: 'code-lab', floor: 'execution', name: 'Data Lab' },
        { type: 'testing-lab', floor: 'execution', name: 'Testing Lab' },
        { type: 'review', floor: 'governance', name: 'Review Chamber' },
      ],
      agents: [
        { name: 'Strategist', role: 'strategist', capabilities: ['chat', 'analysis'], roomAccess: ['strategist', 'discovery'] },
        { name: 'Data Architect', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture', 'discovery'] },
        { name: 'Data Engineer', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'ML Engineer', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'Reviewer', role: 'reviewer', capabilities: ['chat', 'review', 'analysis'], roomAccess: ['review'] },
      ],
    },
    'mobile': {
      templateId: 'web-app',
      rooms: [
        { type: 'strategist', floor: 'strategy', name: 'Strategist Office' },
        { type: 'discovery', floor: 'collaboration', name: 'Discovery Room' },
        { type: 'architecture', floor: 'collaboration', name: 'Mobile Architecture' },
        { type: 'code-lab', floor: 'execution', name: 'Mobile Lab' },
        { type: 'testing-lab', floor: 'execution', name: 'Testing Lab' },
        { type: 'review', floor: 'governance', name: 'Review Chamber' },
        { type: 'deploy', floor: 'operations', name: 'Deploy Control' },
      ],
      agents: [
        { name: 'Strategist', role: 'strategist', capabilities: ['chat', 'analysis'], roomAccess: ['strategist', 'discovery'] },
        { name: 'Mobile Architect', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture', 'discovery'] },
        { name: 'Mobile Dev', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'UI Dev', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'QA Engineer', role: 'tester', capabilities: ['chat', 'testing', 'analysis'], roomAccess: ['testing-lab'] },
        { name: 'Reviewer', role: 'reviewer', capabilities: ['chat', 'review', 'analysis'], roomAccess: ['review'] },
      ],
    },
    'microservices': {
      templateId: 'microservices',
      rooms: [
        { type: 'strategist', floor: 'strategy', name: 'Strategist Office' },
        { type: 'discovery', floor: 'collaboration', name: 'Discovery Room' },
        { type: 'architecture', floor: 'collaboration', name: 'Architecture Studio' },
        { type: 'code-lab', floor: 'execution', name: 'Service Lab A' },
        { type: 'code-lab', floor: 'execution', name: 'Service Lab B' },
        { type: 'code-lab', floor: 'execution', name: 'API Gateway Lab' },
        { type: 'testing-lab', floor: 'execution', name: 'Integration Testing' },
        { type: 'review', floor: 'governance', name: 'Review Chamber' },
        { type: 'deploy', floor: 'operations', name: 'Deploy Control' },
      ],
      agents: [
        { name: 'Strategist', role: 'strategist', capabilities: ['chat', 'analysis'], roomAccess: ['strategist', 'discovery'] },
        { name: 'System Architect', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture', 'discovery'] },
        { name: 'Service Dev A', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'Service Dev B', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'API Specialist', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'QA Lead', role: 'tester', capabilities: ['chat', 'testing', 'analysis'], roomAccess: ['testing-lab'] },
        { name: 'Platform Engineer', role: 'devops', capabilities: ['chat', 'deploy'], roomAccess: ['deploy'] },
      ],
    },
    'library': {
      templateId: 'cli-tool', // Closest existing UI template
      rooms: [
        { type: 'strategist', floor: 'strategy', name: 'Strategist Office' },
        { type: 'discovery', floor: 'collaboration', name: 'Discovery Room' },
        { type: 'architecture', floor: 'collaboration', name: 'API Design Studio' },
        { type: 'code-lab', floor: 'execution', name: 'Library Lab' },
        { type: 'testing-lab', floor: 'execution', name: 'Testing Lab' },
        { type: 'review', floor: 'governance', name: 'Review Chamber' },
      ],
      agents: [
        { name: 'Strategist', role: 'strategist', capabilities: ['chat', 'analysis'], roomAccess: ['strategist', 'discovery'] },
        { name: 'API Designer', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture', 'discovery'] },
        { name: 'Developer', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'QA Engineer', role: 'tester', capabilities: ['chat', 'testing', 'analysis'], roomAccess: ['testing-lab'] },
        { name: 'Reviewer', role: 'reviewer', capabilities: ['chat', 'review', 'analysis'], roomAccess: ['review'] },
      ],
    },
    'desktop': {
      templateId: 'web-app', // Closest existing UI template
      rooms: [
        { type: 'strategist', floor: 'strategy', name: 'Strategist Office' },
        { type: 'discovery', floor: 'collaboration', name: 'Discovery Room' },
        { type: 'architecture', floor: 'collaboration', name: 'Desktop Architecture' },
        { type: 'code-lab', floor: 'execution', name: 'App Lab' },
        { type: 'testing-lab', floor: 'execution', name: 'Testing Lab' },
        { type: 'review', floor: 'governance', name: 'Review Chamber' },
        { type: 'deploy', floor: 'operations', name: 'Build & Package' },
      ],
      agents: [
        { name: 'Strategist', role: 'strategist', capabilities: ['chat', 'analysis'], roomAccess: ['strategist', 'discovery'] },
        { name: 'Desktop Architect', role: 'architect', capabilities: ['chat', 'analysis', 'design'], roomAccess: ['architecture', 'discovery'] },
        { name: 'App Developer', role: 'developer', capabilities: ['chat', 'code', 'testing'], roomAccess: ['code-lab'] },
        { name: 'QA Engineer', role: 'tester', capabilities: ['chat', 'testing', 'analysis'], roomAccess: ['testing-lab'] },
        { name: 'Reviewer', role: 'reviewer', capabilities: ['chat', 'review', 'analysis'], roomAccess: ['review'] },
      ],
    },
  };

  // Default fallback
  const DEFAULT_REC: TemplateRecommendation = {
    templateId: 'web-app',
    rooms: RECOMMENDATIONS['web-app'].rooms,
    agents: RECOMMENDATIONS['web-app'].agents,
  };

  return RECOMMENDATIONS[projectType] || DEFAULT_REC;
}

// ─── Documentation Detection ───

function detectDocumentation(dir: string): string[] {
  const docPaths: string[] = [];
  const candidates = ['docs', 'doc', 'documentation', 'wiki', 'guides'];
  for (const candidate of candidates) {
    const fullPath = path.join(dir, candidate);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        docPaths.push(candidate);
      }
    } catch { /* skip */ }
  }
  // Check for standalone doc files
  const docFiles = ['README.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md', 'API.md'];
  for (const f of docFiles) {
    if (fs.existsSync(path.join(dir, f))) docPaths.push(f);
  }
  return docPaths;
}

// ─── Main Analysis Function ───

/**
 * Analyze a local directory to detect project type, stack, and recommend configuration.
 * This is a fast, synchronous scan — no AI calls required.
 */
export function analyzeCodebase(directoryPath: string): Result<CodebaseAnalysisResult> {
  // Normalize and resolve the path to handle ~, relative paths, etc.
  const dir = path.resolve(path.normalize(directoryPath));

  // Validate the directory exists
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      return err('NOT_DIRECTORY', `Path is not a directory: ${dir}`, { retryable: false });
    }
  } catch {
    return err('PATH_NOT_FOUND', `Directory not found: ${dir}`, { retryable: false });
  }

  log.info({ dir }, 'Analyzing codebase');

  const detectedFiles: DetectedFile[] = [];
  const allTechStack = new Set<string>();
  let primaryLanguage = '';
  let framework: string | null = null;
  let projectType = '';
  let buildSystem: string | null = null;
  let testFramework: string | null = null;
  let hasDocker = false;
  let hasCICD = false;

  // Scan for indicator files
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const fileNames = entries.map(e => e.name);

    for (const [pattern, match] of Object.entries(INDICATOR_FILES)) {
      // Handle directory patterns
      if (pattern.includes('/')) {
        const fullPath = path.join(dir, pattern);
        if (fs.existsSync(fullPath)) {
          detectedFiles.push({ path: pattern, indicator: match.techStack[0] || pattern });
          match.techStack.forEach(t => allTechStack.add(t));
          if (pattern.includes('.github/workflows')) hasCICD = true;
          if (pattern.includes('.circleci')) hasCICD = true;
        }
        continue;
      }

      // Handle glob patterns (*.ext)
      if (pattern.startsWith('*')) {
        const ext = pattern.slice(1);
        const found = fileNames.find(f => f.endsWith(ext));
        if (found) {
          detectedFiles.push({ path: found, indicator: match.techStack[0] || found });
          if (match.language && !primaryLanguage) primaryLanguage = match.language;
          if (match.framework) framework = match.framework;
          if (match.projectType) projectType = match.projectType;
          if (match.buildSystem) buildSystem = match.buildSystem;
          match.techStack.forEach(t => allTechStack.add(t));
        }
        continue;
      }

      // Exact file match
      if (fileNames.includes(pattern)) {
        detectedFiles.push({ path: pattern, indicator: match.techStack[0] || pattern });
        if (match.language && !primaryLanguage) primaryLanguage = match.language;
        if (match.framework) framework = framework || match.framework;
        if (match.projectType) projectType = projectType || match.projectType;
        if (match.buildSystem) buildSystem = buildSystem || match.buildSystem;
        if (match.testFramework) testFramework = testFramework || match.testFramework;
        match.techStack.forEach(t => allTechStack.add(t));

        if (pattern === 'Dockerfile' || pattern.startsWith('docker-compose')) hasDocker = true;
        if (pattern === 'Jenkinsfile' || pattern === '.gitlab-ci.yml') hasCICD = true;
      }
    }

    // Deep inspections for specific ecosystems
    if (fileNames.includes('package.json')) {
      const pkgHints = inspectPackageJson(dir);
      if (pkgHints) {
        if (pkgHints.framework) framework = framework || pkgHints.framework;
        if (pkgHints.projectType) projectType = projectType || pkgHints.projectType;
        if (pkgHints.testFramework) testFramework = testFramework || pkgHints.testFramework;
        pkgHints.techStack.forEach(t => allTechStack.add(t));
      }
    }
    if (fileNames.includes('Cargo.toml')) {
      const cargoHints = inspectCargoToml(dir);
      if (cargoHints) {
        if (cargoHints.projectType) projectType = projectType || cargoHints.projectType;
        cargoHints.techStack.forEach(t => allTechStack.add(t));
      }
    }
    if (fileNames.includes('requirements.txt') || fileNames.includes('pyproject.toml')) {
      const pyHints = inspectPythonProject(dir);
      if (pyHints) {
        if (pyHints.framework) framework = framework || pyHints.framework;
        if (pyHints.projectType) projectType = projectType || pyHints.projectType;
        pyHints.techStack.forEach(t => allTechStack.add(t));
      }
    }

    // Detect microservices pattern
    if (fileNames.includes('docker-compose.yml') || fileNames.includes('docker-compose.yaml')) {
      const subDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules');
      const servicesWithPkg = subDirs.filter(d => {
        const subPath = path.join(dir, d.name);
        return fs.existsSync(path.join(subPath, 'package.json'))
          || fs.existsSync(path.join(subPath, 'Cargo.toml'))
          || fs.existsSync(path.join(subPath, 'go.mod'))
          || fs.existsSync(path.join(subPath, 'requirements.txt'));
      });
      if (servicesWithPkg.length >= 2) {
        projectType = 'microservices';
      }
    }
  } catch (e) {
    log.error({ err: e, dir }, 'Error scanning directory');
    return err('SCAN_FAILED', `Failed to scan directory: ${e instanceof Error ? e.message : String(e)}`, { retryable: false });
  }

  // Default project type
  if (!projectType) projectType = 'web-app';
  if (!primaryLanguage) primaryLanguage = 'Unknown';

  // Detect documentation, git, and maturity
  const documentationPaths = detectDocumentation(dir);
  const hasDocumentation = documentationPaths.length > 0;
  const gitRepoUrl = detectGitUrl(dir);
  const maturity = detectMaturity(dir, !!testFramework, hasCICD, hasDocumentation);

  // Get template recommendation
  const recommendation = recommendTemplate(projectType, primaryLanguage);

  // Extract project name from directory
  const projectName = path.basename(dir);

  // Build summary
  const techStackArr = Array.from(allTechStack);
  const frameworkStr = framework ? ` (${framework})` : '';
  const summary = `${primaryLanguage}${frameworkStr} ${projectType.replace(/-/g, ' ')} with ${techStackArr.length} technologies detected. ` +
    `Project maturity: ${maturity}. ` +
    `${testFramework ? `Testing: ${testFramework}. ` : 'No test framework detected. '}` +
    `${hasCICD ? 'CI/CD configured. ' : 'No CI/CD detected. '}` +
    `${hasDocker ? 'Docker enabled.' : 'No Docker configuration.'}`;

  const result: CodebaseAnalysisResult = {
    projectName,
    projectType,
    primaryLanguage,
    framework,
    buildSystem,
    testFramework,
    hasDocker,
    hasCICD,
    hasDocumentation,
    maturity,
    detectedFiles,
    techStack: techStackArr,
    documentationPaths,
    gitRepoUrl,
    recommendedTemplate: recommendation.templateId,
    recommendedRooms: recommendation.rooms,
    recommendedAgents: recommendation.agents,
    summary,
  };

  log.info({
    dir,
    projectType,
    language: primaryLanguage,
    framework,
    maturity,
    techStackCount: techStackArr.length,
  }, 'Codebase analysis complete');

  return ok(result);
}

// ─── AI-Enhanced Analysis ───

const CODEBASE_ANALYSIS_SYSTEM = `You are an expert software architect analyzing a local codebase for a project orchestration platform called Overlord. Based on the detected files and tech stack, provide a brief, non-technical summary of what this project is and suggest a project description.

RESPOND WITH VALID JSON ONLY:
{
  "description": "A brief, non-technical description of what this project does (1-2 sentences)",
  "goals": "What this project likely aims to achieve (1-2 sentences)",
  "suggestions": "Any additional setup recommendations (1-2 sentences)"
}`;

/**
 * Enhance analysis with AI-generated description and suggestions.
 * Falls back gracefully if AI is unavailable.
 */
export async function enhanceAnalysisWithAI(
  ai: AIProviderAPI,
  analysis: CodebaseAnalysisResult,
  readmeContent?: string,
): Promise<CodebaseAnalysisResult & { aiDescription?: string; aiGoals?: string; aiSuggestions?: string }> {
  // Try to find an available AI provider
  let provider = 'anthropic';
  const adapter = ai.getAdapter(provider);
  if (!adapter || !adapter.validateConfig()) {
    const fallback = ai.getAdapter('minimax');
    if (fallback?.validateConfig()) {
      provider = 'minimax';
    } else {
      log.info('No AI provider available for enhanced analysis — using basic results');
      return analysis;
    }
  }

  const userPrompt = `Analyze this project and provide a description:

Project: ${analysis.projectName}
Type: ${analysis.projectType}
Language: ${analysis.primaryLanguage}
Framework: ${analysis.framework || 'None'}
Tech Stack: ${analysis.techStack.join(', ')}
Maturity: ${analysis.maturity}
Test Framework: ${analysis.testFramework || 'None'}
CI/CD: ${analysis.hasCICD ? 'Yes' : 'No'}
Docker: ${analysis.hasDocker ? 'Yes' : 'No'}
Documentation: ${analysis.documentationPaths.join(', ') || 'None'}
${readmeContent ? `\nREADME (first 2000 chars):\n${readmeContent.slice(0, 2000)}` : ''}

Respond with ONLY valid JSON.`;

  try {
    const result = await ai.sendMessage({
      provider,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [],
      options: {
        system: CODEBASE_ANALYSIS_SYSTEM,
        max_tokens: 512,
        temperature: 0.3,
      },
    });

    if (result.ok) {
      const response = result.data as { content: Array<{ type: string; text?: string }> };
      const textBlock = response.content?.find(b => b.type === 'text');
      const rawText = textBlock?.text || '';
      let cleaned = rawText.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      try {
        const parsed = JSON.parse(cleaned) as { description?: string; goals?: string; suggestions?: string };
        return {
          ...analysis,
          aiDescription: parsed.description,
          aiGoals: parsed.goals,
          aiSuggestions: parsed.suggestions,
        };
      } catch {
        log.warn('Failed to parse AI enhancement response');
      }
    }
  } catch (e) {
    log.warn({ err: e }, 'AI enhancement failed — using basic analysis');
  }

  return analysis;
}
