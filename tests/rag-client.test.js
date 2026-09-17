import assert from 'node:assert/strict';
import test from 'node:test';

function parseCitationTarget(citation) {
  const note = citation.note || '';
  const heading = citation.heading ? `#${citation.heading}` : '';
  return `${note}${heading}`;
}

function filterGraphNodesByRelationship(graphNodes, relationship) {
  return (graphNodes || []).filter(node => node.relationship === relationship);
}

test('parses citation targets and formats accurate note links', () => {
  const citationWithHeading = {
    note: 'Architecture/DLP-Shield.md',
    heading: 'Secret Detection',
    start_line: 12,
    similarity: 0.96,
    score_pct: 96,
    excerpt: 'Detects AWS secrets and API tokens.'
  };

  const citationWithoutHeading = {
    note: 'Protocols/Sync.md',
    heading: null,
    start_line: 1,
    similarity: 0.91,
    score_pct: 91,
    excerpt: 'Validates SHA-256 on push.'
  };

  assert.equal(parseCitationTarget(citationWithHeading), 'Architecture/DLP-Shield.md#Secret Detection');
  assert.equal(parseCitationTarget(citationWithoutHeading), 'Protocols/Sync.md');
});

test('filters graph nodes by relationship and formats backlink chips', () => {
  const sampleNodes = [
    { path: 'Security/Path-ACLs.md', title: 'Path-ACLs', relationship: 'backlink', via: 'Architecture/DLP-Shield.md' },
    { path: 'Transport/E2EE.md', title: 'E2EE', relationship: 'outbound', via: 'Architecture/DLP-Shield.md' },
    { path: 'Protocols/Sync.md', title: 'Sync', relationship: 'backlink', via: 'Security/Path-ACLs.md' }
  ];

  const backlinks = filterGraphNodesByRelationship(sampleNodes, 'backlink');
  assert.equal(backlinks.length, 2);
  assert.equal(backlinks[0].title, 'Path-ACLs');
  assert.equal(backlinks[1].title, 'Sync');

  const outbounds = filterGraphNodesByRelationship(sampleNodes, 'outbound');
  assert.equal(outbounds.length, 1);
  assert.equal(outbounds[0].title, 'E2EE');
});
