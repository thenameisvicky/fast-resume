const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { verifyRun, unattested, buildVocab, overlapRatio } = require('../server/verify.js');

const mockFacts = {
  name: "VIGNESHWARAN B",
  summary: {
    id: "s-1",
    text: "Software Engineer with experience building SaaS apps. Used RabbitMQ Qdrant FastAPI Docker and MongoDB. Integrated FHIR EHR APIs with Azure Blob Storage over SFTP. Voice AI agent timelines."
  },
  experience: [
    {
      id: "e-2",
      org: "Voxy India Private Limited",
      dates: "October 2025 – Present",
      role: "SDE Full time",
      bullets: [
        {
          id: "b-3",
          text: "Designed transcript reconciliation workflows to merge AI and human conversation streams into consistent production records."
        }
      ]
    }
  ],
  skills: [
    {
      id: "k-18",
      label: "Backend",
      items: ["RAG", "RabbitMQ", "Qdrant", "FastAPI", "Docker", "MongoDB", "FHIR", "EHR", "Azure", "Blob", "Storage", "SFTP", "AWS"]
    }
  ]
};

const facts = mockFacts;
const vocab = buildVocab(facts);

const clone = (o) => JSON.parse(JSON.stringify(o));

// The real bullet these tests rewrite, so expectations stay honest.
const SRC = facts.experience[0].bullets[0];

function runWith(bullets, extra = {}) {
  return verifyRun({
    name: facts.name,
    summary: { id: facts.summary.id, text: facts.summary.text },
    experience: [{ ...facts.experience[0], bullets }],
    projects: [],
    skills: clone(facts.skills),
    ...extra,
  }, facts);
}

test('a faithful rewrite using only attested terms passes clean', () => {
  const out = runWith([{
    id: SRC.id, from: SRC.id,
    text: 'Built transcript reconciliation services for production voice workflows, merging AI-agent and human conversation timelines.',
  }]);
  assert.equal(out.verification.rejected.length, 0);
  assert.equal(out.verification.flagged.length, 0);
  assert.equal(out.experience[0].bullets.length, 1);
});

test('invented technologies are flagged', () => {
  const out = runWith([{
    id: SRC.id, from: SRC.id,
    text: 'Built transcript reconciliation services on Kubernetes and AWS Bedrock, merging AI-agent and human conversation timelines for production voice workflows.',
  }]);
  const flags = out.verification.flagged;
  assert.equal(flags.length, 1);
  const tokens = flags[0].issues[0].tokens;
  assert.ok(tokens.includes('Kubernetes'), `expected Kubernetes, got ${tokens}`);
  assert.ok(tokens.includes('Bedrock'), `expected Bedrock, got ${tokens}`);
});

test('invented metrics are flagged', () => {
  const out = runWith([{
    id: SRC.id, from: SRC.id,
    text: 'Built transcript reconciliation services merging AI-agent and human conversation timelines, cutting review time by 40% for production voice workflows.',
  }]);
  const tokens = out.verification.flagged[0].issues[0].tokens;
  assert.ok(tokens.some((t) => t.includes('40')), `expected the 40% claim, got ${tokens}`);
});

test('an uncited bullet is rejected, not shown', () => {
  const out = runWith([{ id: SRC.id, text: 'Led a team of eight engineers.' }]);
  assert.equal(out.verification.rejected.length, 1);
  assert.equal(out.verification.rejected[0].issues[0].kind, 'no-citation');
});

test('a citation to a non-existent fact is rejected', () => {
  const out = runWith([{ id: SRC.id, from: 'b-999', text: 'Built transcript reconciliation services.' }]);
  assert.equal(out.verification.rejected[0].issues[0].kind, 'bad-citation');
});

test('a bullet that drifts from its cited source is rejected and reverted', () => {
  const out = runWith([{
    id: SRC.id, from: SRC.id,
    text: 'Owned the company hiring strategy and closed twelve enterprise accounts.',
  }]);
  assert.equal(out.verification.rejected[0].issues[0].kind, 'weak-citation');
  assert.equal(out.experience[0].bullets[0].text, SRC.text, 'should revert to the original wording');
  assert.equal(out.experience[0].bullets[0].reverted, true);
});

test('skills cannot gain items that are not already yours', () => {
  const skills = clone(facts.skills);
  skills[0].items = ['Kubernetes', 'Terraform', ...skills[0].items];
  const out = runWith([{ id: SRC.id, from: SRC.id, text: SRC.text }], { skills });
  assert.ok(!out.skills[0].items.includes('Kubernetes'));
  assert.ok(!out.skills[0].items.includes('Terraform'));
  assert.ok(out.skills[0].items.includes('RAG'), 'real skills must survive');
  const invented = out.verification.rejected.filter((r) => r.issues[0].kind === 'invented-skill');
  assert.equal(invented.length, 2);
});

test('skill re-ordering is allowed', () => {
  const skills = clone(facts.skills);
  skills[0].items = [...skills[0].items].reverse();
  const out = runWith([{ id: SRC.id, from: SRC.id, text: SRC.text }], { skills });
  assert.equal(out.skills[0].items.length, facts.skills[0].items.length);
  assert.equal(out.verification.rejected.length, 0);
});

test('ordinary English words are not mistaken for invented claims', () => {
  assert.deepEqual(unattested('Built and shipped production services with strong reliability.', vocab), []);
  assert.deepEqual(unattested('Developed pipelines for quality and workflow reliability.', vocab), []);
});

test('terms genuinely in the resume are never flagged', () => {
  assert.deepEqual(unattested('Used RabbitMQ, Qdrant, FastAPI, Docker and MongoDB.', vocab), []);
  assert.deepEqual(unattested('Integrated FHIR/EHR APIs with Azure Blob Storage over SFTP.', vocab), []);
});

test('overlap ratio separates a rewrite from a replacement', () => {
  assert.ok(overlapRatio(SRC.text, SRC.text) === 1);
  assert.ok(overlapRatio('Built transcript reconciliation for voice workflows', SRC.text) > 0.5);
  assert.ok(overlapRatio('Managed procurement budgets across three regions', SRC.text) < 0.2);
});
