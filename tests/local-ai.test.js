import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApiUrl,
  buildCitationOpenTarget,
  buildLocalChatMessages,
  buildLocalSmartMergeMessages,
  buildProposalDiffLines,
  expandGraphNeighbors,
  extractCitationPath,
  extractProposalInitialContent,
  extractProposalTargetPath,
  extractRelevantExcerpt,
  formatCitationLabel,
  formatProposalsBadgeText,
  normalizeEchoPrivateChannel,
  parseSmartMergeOutput,
  rankDocumentsBm25,
  tokenizeText,
} from '../src/localAiCore.js';

describe('localAiCore tokenization and BM25 ranking', () => {
  it('tokenizes text while stripping stopwords and punctuation', () => {
    const tokens = tokenizeText('The quick Synkk AI vault sync, with E2EE & Zero-Knowledge!');
    assert.ok(tokens.includes('synkk'));
    assert.ok(tokens.includes('ai'));
    assert.ok(tokens.includes('e2ee'));
    assert.ok(tokens.includes('zero-knowledge'));
    assert.equal(tokens.includes('the'), false);
    assert.equal(tokens.includes('with'), false);
  });

  it('ranks relevant markdown documents highest using BM25 + title boost', () => {
    const docs = [
      {
        path: 'Daily/2026-11-20.md',
        content: 'Bought groceries and scheduled a dentist appointment.',
      },
      {
        path: 'Architecture/E2EE Sync Protocol.md',
        content: 'Synkk encrypts every markdown blob client-side using AES-256-GCM before upload.',
      },
      {
        path: 'Projects/Roadmap.md',
        content: 'Quarter goals include mobile sync optimizations and E2EE testing.',
      },
    ];

    const ranked = rankDocumentsBm25('How does E2EE sync work?', docs, { topK: 2 });
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].path, 'Architecture/E2EE Sync Protocol.md');
    assert.ok(ranked[0].score > ranked[1].score);
  });

  it('returns empty list for empty query or empty corpus', () => {
    assert.deepEqual(rankDocumentsBm25('', [{ path: 'a.md', content: 'hello' }]), []);
    assert.deepEqual(rankDocumentsBm25('hello world', []), []);
  });
});

describe('localAiCore graph expansion & excerpts', () => {
  it('expands 1-hop outgoing links and incoming backlinks without duplicating seeds', () => {
    const docs = new Map([
      ['seed.md', { path: 'seed.md', content: 'Seed note mentioning [[outgoing.md]].' }],
      ['outgoing.md', { path: 'outgoing.md', content: 'Linked detail note.' }],
      ['backlink.md', { path: 'backlink.md', content: 'References [[seed.md]].' }],
      ['unrelated.md', { path: 'unrelated.md', content: 'No connection.' }],
    ]);

    const resolvedLinks = {
      'seed.md': { 'outgoing.md': 2 },
      'backlink.md': { 'seed.md': 1 },
      'unrelated.md': {},
    };

    const seeds = [{ path: 'seed.md', title: 'seed', content: 'Seed', outgoingLinks: [], score: 4 }];
    const expanded = expandGraphNeighbors(seeds, docs, resolvedLinks, { maxNeighbors: 3 });

    assert.equal(expanded.seedDocs.length, 1);
    assert.equal(expanded.neighborDocs.length, 2);
    assert.deepEqual(
      expanded.combinedDocs.map((d) => d.path),
      ['seed.md', 'outgoing.md', 'backlink.md']
    );
    assert.equal(expanded.neighborDocs[0].viaGraph, true);
  });

  it('extracts relevant excerpt centered around matching tokens', () => {
    const filler = 'Introductory logistics paragraph. '.repeat(25);
    const target = 'CRITICAL DETAIL: Rotate the recovery key inside Vault Settings every quarter.';
    const content = `${filler}\n\n${target}\n\n${filler}`;

    const excerpt = extractRelevantExcerpt(content, ['recovery', 'key'], 220);
    assert.ok(excerpt.includes('CRITICAL DETAIL'));
    assert.ok(excerpt.length <= 240);
  });
});

describe('localAiCore prompt builders & helpers', () => {
  it('builds local E2EE chat messages with system disclaimer, history, and context blocks', () => {
    const messages = buildLocalChatMessages(
      'What is the key policy?',
      [{ path: 'Security/Keys.md', excerpt: 'Rotate every 90 days.', viaGraph: true }],
      [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }],
      'Security/Overview.md'
    );

    assert.equal(messages[0].role, 'system');
    assert.ok(messages[0].content.includes('Zero-Knowledge E2EE'));
    assert.equal(messages[1].role, 'user');
    assert.equal(messages[2].role, 'assistant');
    assert.equal(messages[3].role, 'user');
    assert.ok(messages[3].content.includes('Source 1: Security/Keys.md [1-hop link]'));
    assert.ok(messages[3].content.includes('Currently open note: Security/Overview.md'));
  });

  it('builds local Smart Merge messages including instructions when supplied', () => {
    const messages = buildLocalSmartMergeMessages({
      conflictPath: 'Notes/Plan.sync-conflict.md',
      canonicalPath: 'Notes/Plan.md',
      canonicalText: 'Canonical text',
      conflictText: 'Conflict text',
      instructions: 'Prefer conflict bullet points',
    });

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.ok(messages[1].content.includes('Canonical text'));
    assert.ok(messages[1].content.includes('Conflict text'));
    assert.ok(messages[1].content.includes('Prefer conflict bullet points'));
  });

  it('normalizes Reverb private channel names by stripping private- prefix', () => {
    assert.equal(normalizeEchoPrivateChannel('private-vault-ai.12.5'), 'vault-ai.12.5');
    assert.equal(normalizeEchoPrivateChannel('vault-ai.12.5'), 'vault-ai.12.5');
    assert.equal(normalizeEchoPrivateChannel(''), '');
  });

  it('formats status bar proposals badge counts cleanly', () => {
    assert.equal(formatProposalsBadgeText(0), '');
    assert.equal(formatProposalsBadgeText(-1), '');
    assert.equal(formatProposalsBadgeText(3), '✨ 3 AI');
    assert.equal(formatProposalsBadgeText(150), '✨ 99+ AI');
  });
});

describe('localAiCore Synkk API & proposal contract helpers', () => {
  it('builds API URLs without duplicating /api/v1 prefix', () => {
    assert.equal(
      buildApiUrl('https://synkk.space/api/v1', '/vaults/demo/ai/threads'),
      'https://synkk.space/api/v1/vaults/demo/ai/threads'
    );
    assert.equal(
      buildApiUrl('https://synkk.space/api/v1/', 'vaults/demo/ai/threads'),
      'https://synkk.space/api/v1/vaults/demo/ai/threads'
    );
    assert.equal(
      buildApiUrl('https://synkk.space/', '/vaults/demo/ai/threads'),
      'https://synkk.space/api/v1/vaults/demo/ai/threads'
    );
    assert.equal(
      buildApiUrl('https://synkk.space/api/v1', '/broadcasting/auth'),
      'https://synkk.space/api/v1/broadcasting/auth'
    );
    assert.equal(
      buildApiUrl('https://synkk.space', '/broadcasting/auth'),
      'https://synkk.space/api/v1/broadcasting/auth'
    );
  });

  it('parses server citations ("note") and local citations ("file_path") uniformly', () => {
    const serverCitation = {
      note: 'Architecture/Sync Protocol.md',
      heading: 'Conflict Handling',
      start_line: 14,
      score_pct: 94,
    };
    const localCitation = {
      file_path: 'Projects/Roadmap.md',
      title: 'Roadmap',
    };

    assert.equal(extractCitationPath(serverCitation), 'Architecture/Sync Protocol.md');
    assert.equal(formatCitationLabel(serverCitation), 'Sync Protocol #Conflict Handling');
    assert.equal(
      buildCitationOpenTarget(serverCitation),
      'Architecture/Sync Protocol.md#Conflict Handling'
    );

    assert.equal(extractCitationPath(localCitation), 'Projects/Roadmap.md');
    assert.equal(formatCitationLabel(localCitation), 'Roadmap');
    assert.equal(buildCitationOpenTarget(localCitation), 'Projects/Roadmap.md');
  });

  it('extracts proposal target path, initial merged override, and colored hunks from Laravel proposals', () => {
    const createProposal = {
      id: 1,
      action: 'create',
      source: 'copilot',
      target_path: 'Notes/NewBrief.md',
      proposed_content: '# Brief\nLine 1',
      preview: {
        is_stale: false,
        current_content: '',
        proposed_content: '# Brief\nLine 1',
        diff: { has_conflicts: false, conflict_count: 0, clean_count: 1, merged_content: '# Brief\nLine 1', hunks: [] },
      },
    };
    assert.equal(extractProposalTargetPath(createProposal), 'Notes/NewBrief.md');
    assert.equal(extractProposalInitialContent(createProposal), '# Brief\nLine 1');
    assert.deepEqual(buildProposalDiffLines(createProposal), [
      { type: 'add', content: '# Brief' },
      { type: 'add', content: 'Line 1' },
    ]);

    const staleProposal = {
      id: 2,
      action: 'move',
      source: 'gardener_triage',
      target_path: 'Inbox/Note.md',
      destination_path: 'Projects/Note.md',
      proposed_content: 'old proposed',
      preview: {
        is_stale: true,
        current_content: '# Heading\nHuman line\nFooter',
        proposed_content: '# Heading\nOld\nFooter (AI)',
        diff: {
          has_conflicts: true,
          conflict_count: 1,
          clean_count: 1,
          merged_content: '# Heading\nHuman merged\nFooter (AI)',
          hunks: [
            {
              id: 0,
              type: 'clean',
              is_conflict: false,
              base_lines: ['# Heading'],
              our_lines: ['# Heading'],
              their_lines: ['# Heading'],
              resolved_lines: ['# Heading'],
              choice: 'clean',
            },
            {
              id: 1,
              type: 'conflict',
              is_conflict: true,
              base_lines: ['Old'],
              our_lines: ['Human line'],
              their_lines: ['AI line'],
              resolved_lines: [],
              choice: 'ours',
            },
          ],
        },
      },
    };
    assert.equal(extractProposalTargetPath(staleProposal), 'Inbox/Note.md');
    assert.equal(extractProposalInitialContent(staleProposal), '# Heading\nHuman merged\nFooter (AI)');
    const staleDiff = buildProposalDiffLines(staleProposal);
    assert.deepEqual(staleDiff, [
      { type: 'context', content: '# Heading' },
      { type: 'conflict', content: '@@ Conflict (Current vs Proposed) @@' },
      { type: 'remove', content: 'Human line' },
      { type: 'add', content: 'AI line' },
    ]);
  });

  it('parses fenced, prose-wrapped, and plain markdown Smart Merge outputs safely', () => {
    const fenced = parseSmartMergeOutput('```json\n{"merged_content":"# Combined","summary":"Merged cleanly"}\n```');
    assert.equal(fenced.mergedContent, '# Combined');
    assert.equal(fenced.summary, 'Merged cleanly');

    const prose = parseSmartMergeOutput('Here is your result: {"merged_content":"# Body"} done.');
    assert.equal(prose.mergedContent, '# Body');
    assert.ok(prose.summary.includes('E2EE Local AI'));

    const fallback = parseSmartMergeOutput('# Plain Markdown Note\n- Item A');
    assert.equal(fallback.mergedContent, '# Plain Markdown Note\n- Item A');
  });
});
