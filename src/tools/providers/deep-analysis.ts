/**
 * Deep Analysis Tool Provider
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import type { Result } from '../../core/contracts.js';
export interface SecurityResult { vulnerabilities: number; critical: number; high: number; moderate: number; low: number; details: string; }
export interface DependencyResult { outdated: number; major: number; minor: number; patch: number; details: string; }
export interface ComplexityResult { totalFiles: number; totalLines: number; filesByExtension: Record<string, number>; largestFiles: Array<{ path: string; lines: number }>; }
export interface DeepAnalysisResult { security: SecurityResult | null; dependencies: DependencyResult | null; complexity: ComplexityResult | null; summary: string; }
type AnalysisType = 'security' | 'dependencies' | 'complexity' | 'all';
function detectPackageManager(projectDir: string): 'npm' | 'cargo' | 'pip' | 'go' | 'unknown' {
  if (fs.existsSync(path.join(projectDir, 'package.json'))) return 'npm';
  if (fs.existsSync(path.join(projectDir, 'Cargo.toml'))) return 'cargo';
  if (fs.existsSync(path.join(projectDir, 'requirements.txt')) || fs.existsSync(path.join(projectDir, 'pyproject.toml'))) return 'pip';
  if (fs.existsSync(path.join(projectDir, 'go.mod'))) return 'go';
  return 'unknown';
}
async function runSecurityAnalysis(projectDir: string, pm: string): Promise<SecurityResult> {
  let command: string;
  switch (pm) { case 'npm': command = 'npm audit --json 2>&1'; break; case 'cargo': command = 'cargo audit --json 2>&1'; break; default: return { vulnerabilities: 0, critical: 0, high: 0, moderate: 0, low: 0, details: 'No security audit tool available' }; }
  const result = await executeShell({ command, cwd: projectDir, timeout: 120_000 });
  if (pm === 'npm') { try { const parsed = JSON.parse(result.stdout); const meta = parsed.metadata?.vulnerabilities ?? {}; return { vulnerabilities: (meta.total ?? 0) as number, critical: (meta.critical ?? 0) as number, high: (meta.high ?? 0) as number, moderate: (meta.moderate ?? 0) as number, low: (meta.low ?? 0) as number, details: result.stdout.slice(0, 1000) }; } catch { return { vulnerabilities: result.exitCode !== 0 ? 1 : 0, critical: 0, high: 0, moderate: 0, low: 0, details: result.stdout.slice(0, 1000) }; } }
  try { const parsed = JSON.parse(result.stdout); const vulns = parsed.vulnerabilities?.found ?? 0; return { vulnerabilities: vulns as number, critical: 0, high: 0, moderate: 0, low: 0, details: result.stdout.slice(0, 1000) }; } catch { return { vulnerabilities: result.exitCode !== 0 ? 1 : 0, critical: 0, high: 0, moderate: 0, low: 0, details: result.stdout.slice(0, 1000) }; }
}
async function runDependencyAnalysis(projectDir: string, pm: string): Promise<DependencyResult> {
  if (pm !== 'npm') return { outdated: 0, major: 0, minor: 0, patch: 0, details: 'Dependency check only available for npm projects' };
  const result = await executeShell({ command: 'npm outdated --json 2>&1', cwd: projectDir, timeout: 120_000 });
  try { const parsed = JSON.parse(result.stdout); const entries = Object.values(parsed) as Array<{ current?: string; wanted?: string; latest?: string }>; let major = 0; let minor = 0; let patch = 0; for (const dep of entries) { if (!dep.current || !dep.latest) continue; const [curMaj, curMin] = dep.current.split('.').map(Number); const [latMaj, latMin] = dep.latest.split('.').map(Number); if (latMaj > curMaj) major++; else if (latMin > curMin) minor++; else patch++; } return { outdated: entries.length, major, minor, patch, details: result.stdout.slice(0, 1000) }; } catch { return { outdated: 0, major: 0, minor: 0, patch: 0, details: result.stdout.slice(0, 500) }; }
}
async function runComplexityAnalysis(projectDir: string): Promise<ComplexityResult> {
  const filesByExtension: Record<string, number> = {}; const fileSizes: Array<{ path: string; lines: number }> = []; let totalFiles = 0; let totalLines = 0;
  const result = await executeShell({ command: 'find . -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.rs" -o -name "*.go" \\) ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" -exec wc -l {} + 2>/dev/null | head -500', cwd: projectDir, timeout: 30_000 });
  for (const line of result.stdout.split('\n').filter(l => l.trim().length > 0)) { const match = line.trim().match(/^\s*(\d+)\s+(.+)$/); if (!match) continue; const lineCount = parseInt(match[1], 10); const filePath = match[2]; if (filePath === 'total') { totalLines = lineCount; continue; } totalFiles++; const ext = path.extname(filePath) || 'none'; filesByExtension[ext] = (filesByExtension[ext] || 0) + 1; fileSizes.push({ path: filePath, lines: lineCount }); }
  if (totalLines === 0) totalLines = fileSizes.reduce((sum, f) => sum + f.lines, 0);
  fileSizes.sort((a, b) => b.lines - a.lines);
  return { totalFiles, totalLines, filesByExtension, largestFiles: fileSizes.slice(0, 10) };
}
export async function executeDeepAnalysis(params: { projectDir: string; analysisType?: AnalysisType }): Promise<Result<DeepAnalysisResult>> {
  const { projectDir, analysisType = 'all' } = params;
  if (!fs.existsSync(projectDir)) return err('NOT_FOUND', 'Project directory does not exist: ' + projectDir, { retryable: false });
  const pm = detectPackageManager(projectDir);
  try {
    let security: SecurityResult | null = null; let dependencies: DependencyResult | null = null; let complexity: ComplexityResult | null = null;
    if (analysisType === 'security' || analysisType === 'all') security = await runSecurityAnalysis(projectDir, pm);
    if (analysisType === 'dependencies' || analysisType === 'all') dependencies = await runDependencyAnalysis(projectDir, pm);
    if (analysisType === 'complexity' || analysisType === 'all') complexity = await runComplexityAnalysis(projectDir);
    const parts: string[] = []; if (security) parts.push('Security: ' + security.vulnerabilities + ' vulnerabilities'); if (dependencies) parts.push('Dependencies: ' + dependencies.outdated + ' outdated'); if (complexity) parts.push('Complexity: ' + complexity.totalFiles + ' files, ' + complexity.totalLines + ' lines');
    return ok({ security, dependencies, complexity, summary: parts.join('; ') || 'No analysis performed' });
  } catch (error) { const message = error instanceof Error ? error.message : String(error); return err('ANALYSIS_ERROR', 'Deep analysis failed: ' + message, { retryable: true }); }
}
