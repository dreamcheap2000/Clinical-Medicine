const test = require('node:test');
const assert = require('node:assert/strict');
const SimilarityUtils = require('../Similarity.js');

test('normalizeText converts full-width text and strips punctuation', () => {
  assert.equal(
    SimilarityUtils.normalizeText('　偏頭痛，怎麼辦？Ｈｅｌｌｏ！ '),
    '偏頭痛 怎麼辦 hello'
  );
});

test('findBestMatch selects the closest QA answer', () => {
  const index = SimilarityUtils.buildIndex([
    {
      question: '偏頭痛怎麼辦',
      answer: '請先休息、補充水分，並依醫囑用藥。',
      keywords: '頭痛 migraine'
    },
    {
      question: '失眠怎麼改善',
      answer: '規律作息並避免睡前攝取咖啡因。',
      keywords: '睡眠 insomnia'
    }
  ]);

  const result = SimilarityUtils.findBestMatch('我最近一直偏頭痛該怎麼辦？', index, {
    threshold: 0.2
  });

  assert.equal(result.match.question, '偏頭痛怎麼辦');
  assert.ok(result.score > 0.2);
});

test('findBestMatch returns no match below threshold', () => {
  const index = SimilarityUtils.buildIndex([
    {
      question: '偏頭痛怎麼辦',
      answer: '請先休息、補充水分，並依醫囑用藥。',
      keywords: '頭痛 migraine'
    }
  ]);

  const result = SimilarityUtils.findBestMatch('今天午餐吃什麼', index, {
    threshold: 0.5
  });

  assert.equal(result.match, null);
  assert.ok(result.score < 0.5);
});
