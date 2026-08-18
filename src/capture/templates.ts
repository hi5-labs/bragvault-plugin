import type { GitCommitInfo, RepoInfo, SessionInfo, StructuredAccomplishment } from '../types.js';

/**
 * Deterministic, template-built summaries for passive events. No model calls:
 * rich narratives come from the host agent via the MCP tools instead.
 */

const EXT_TECH: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.c': 'C',
  '.cpp': 'C++',
  '.cs': 'C#',
  '.php': 'PHP',
  '.sql': 'SQL',
  '.tf': 'Terraform',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.dockerfile': 'Docker',
};

export function technologiesFromFileTypes(fileTypes: Record<string, number>): string[] {
  const techs = new Set<string>();
  for (const ext of Object.keys(fileTypes)) {
    const tech = EXT_TECH[ext.toLowerCase()];
    if (tech) techs.add(tech);
  }
  return [...techs].sort();
}

function firstLine(message: string): string {
  return (message.split('\n')[0] ?? '').trim();
}

export function commitToStructured(commit: GitCommitInfo, repo: RepoInfo): StructuredAccomplishment {
  const subject = firstLine(commit.message) || 'Code change';
  const linesChanged = commit.insertions + commit.deletions;
  const kind = commit.tags.length > 0 ? 'Tagged release' : commit.isMerge ? 'Merged branch' : 'Committed';
  const scope = `${commit.filesChanged} file${commit.filesChanged === 1 ? '' : 's'}, ${linesChanged} line${linesChanged === 1 ? '' : 's'} changed`;
  return {
    title: subject.slice(0, 100),
    summary: `${kind} "${subject}" in ${repo.name} (${scope}).`,
    category: commit.tags.length > 0 ? 'major_milestone' : 'small_win',
    technologies: technologiesFromFileTypes(commit.fileTypes),
    context: repo.branch ? `branch ${repo.branch}` : null,
  };
}

export function sessionToStructured(session: SessionInfo, repo: RepoInfo | undefined, narrative?: string): StructuredAccomplishment {
  const where = repo ? ` in ${repo.name}` : '';
  const bits: string[] = [];
  if (session.durationMinutes) bits.push(`${session.durationMinutes} min`);
  if (session.filesTouchedCount) bits.push(`${session.filesTouchedCount} files touched`);
  const detail = bits.length ? ` (${bits.join(', ')})` : '';
  return {
    title: narrative ? narrative.slice(0, 100) : `Coding session${where}`,
    summary: narrative ?? `Completed a coding session${where}${detail}.`,
    category: 'small_win',
    technologies: [],
  };
}
