(function(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SimilarityUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function normalizeText(input) {
    return String(input || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactText(input) {
    return normalizeText(input).replace(/\s+/g, '');
  }

  function charBigrams(input) {
    var text = compactText(input);
    if (!text) return [];
    if (text.length === 1) return [text];
    var grams = [];
    for (var i = 0; i < text.length - 1; i += 1) {
      grams.push(text.slice(i, i + 2));
    }
    return grams;
  }

  function tokenize(input) {
    var normalized = normalizeText(input);
    if (!normalized) return [];
    var baseTokens = normalized.split(' ').filter(Boolean);
    var tokens = baseTokens.slice();
    baseTokens.forEach(function(token) {
      if (token.length > 1) {
        tokens = tokens.concat(charBigrams(token));
      }
    });
    if (baseTokens.length === 1 && baseTokens[0].length > 1 && tokens.length === 1) {
      tokens = tokens.concat(charBigrams(baseTokens[0]));
    }
    return tokens;
  }

  function counts(values) {
    var map = {};
    values.forEach(function(value) {
      map[value] = (map[value] || 0) + 1;
    });
    return map;
  }

  function unique(values) {
    return Object.keys(counts(values));
  }

  function jaccardSimilarity(left, right) {
    var a = unique(left || []);
    var b = unique(right || []);
    if (a.length === 0 && b.length === 0) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    var aSet = {};
    a.forEach(function(value) { aSet[value] = true; });
    var intersection = 0;
    b.forEach(function(value) {
      if (aSet[value]) intersection += 1;
    });
    return intersection / (a.length + b.length - intersection);
  }

  function diceCoefficient(left, right) {
    var leftCounts = counts(left || []);
    var rightCounts = counts(right || []);
    var leftKeys = Object.keys(leftCounts);
    var rightKeys = Object.keys(rightCounts);
    if (leftKeys.length === 0 && rightKeys.length === 0) return 1;
    if (leftKeys.length === 0 || rightKeys.length === 0) return 0;
    var overlap = 0;
    leftKeys.forEach(function(key) {
      if (rightCounts[key]) {
        overlap += Math.min(leftCounts[key], rightCounts[key]);
      }
    });
    return (2 * overlap) / ((left || []).length + (right || []).length);
  }

  function buildIdf(items) {
    var docCount = items.length || 1;
    var df = {};
    items.forEach(function(item) {
      var seen = {};
      item.questionTokens.concat(item.answerTokens, item.keywordTokens).forEach(function(token) {
        if (!seen[token]) {
          seen[token] = true;
          df[token] = (df[token] || 0) + 1;
        }
      });
    });
    var idf = {};
    Object.keys(df).forEach(function(token) {
      idf[token] = Math.log((1 + docCount) / (1 + df[token])) + 1;
    });
    return idf;
  }

  function tfidfVector(tokens, idf) {
    var tf = counts(tokens || []);
    var vector = {};
    Object.keys(tf).forEach(function(token) {
      vector[token] = tf[token] * (idf[token] || 1);
    });
    return vector;
  }

  function cosineSimilarity(leftVector, rightVector) {
    var leftKeys = Object.keys(leftVector || {});
    var rightKeys = Object.keys(rightVector || {});
    if (leftKeys.length === 0 || rightKeys.length === 0) return 0;
    var dot = 0;
    var leftNorm = 0;
    var rightNorm = 0;

    leftKeys.forEach(function(key) {
      var leftValue = leftVector[key] || 0;
      leftNorm += leftValue * leftValue;
      if (rightVector[key]) {
        dot += leftValue * rightVector[key];
      }
    });

    rightKeys.forEach(function(key) {
      var rightValue = rightVector[key] || 0;
      rightNorm += rightValue * rightValue;
    });

    if (!leftNorm || !rightNorm) return 0;
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  function parseKeywords(input) {
    return normalizeText(String(input || '').replace(/[;,|]/g, ' ')).split(' ').filter(Boolean);
  }

  function buildIndex(items) {
    var normalizedItems = (items || []).map(function(item) {
      return {
        question: item.question || '',
        answer: item.answer || '',
        keywords: item.keywords || '',
        enabled: item.enabled !== false,
        normalizedQuestion: normalizeText(item.question || ''),
        normalizedAnswer: normalizeText(item.answer || ''),
        questionTokens: tokenize(item.question || ''),
        answerTokens: tokenize(item.answer || ''),
        keywordTokens: parseKeywords(item.keywords || ''),
        questionBigrams: charBigrams(item.question || ''),
        answerBigrams: charBigrams(item.answer || '')
      };
    }).filter(function(item) {
      return item.enabled && item.normalizedQuestion;
    });

    var idf = buildIdf(normalizedItems);
    normalizedItems.forEach(function(item) {
      item.questionVector = tfidfVector(item.questionTokens, idf);
      item.answerVector = tfidfVector(item.answerTokens, idf);
    });

    return {
      items: normalizedItems,
      idf: idf
    };
  }

  function scoreCandidate(query, item, idf) {
    var normalizedQuery = normalizeText(query || '');
    var queryTokens = tokenize(normalizedQuery);
    var queryBigrams = charBigrams(normalizedQuery);
    var queryVector = tfidfVector(queryTokens, idf || {});

    var questionJaccard = jaccardSimilarity(queryBigrams, item.questionBigrams);
    var questionDice = diceCoefficient(queryBigrams, item.questionBigrams);
    var questionCosine = cosineSimilarity(queryVector, item.questionVector || {});
    var answerCosine = cosineSimilarity(queryVector, item.answerVector || {});
    var answerDice = diceCoefficient(queryBigrams, item.answerBigrams);

    var keywordHits = 0;
    item.keywordTokens.forEach(function(token) {
      if (normalizedQuery.indexOf(token) !== -1) {
        keywordHits += 1;
      }
    });
    var keywordBonus = item.keywordTokens.length
      ? Math.min(0.15, (keywordHits / item.keywordTokens.length) * 0.15)
      : 0;

    var score =
      questionJaccard * 0.2 +
      questionDice * 0.2 +
      questionCosine * 0.35 +
      answerCosine * 0.1 +
      answerDice * 0.05 +
      keywordBonus;

    return {
      score: Math.max(0, Math.min(1, score)),
      breakdown: {
        questionJaccard: questionJaccard,
        questionDice: questionDice,
        questionCosine: questionCosine,
        answerCosine: answerCosine,
        answerDice: answerDice,
        keywordBonus: keywordBonus
      }
    };
  }

  function findBestMatch(query, index, options) {
    var threshold = options && typeof options.threshold === 'number' ? options.threshold : 0.35;
    var best = null;

    (index.items || []).forEach(function(item) {
      var result = scoreCandidate(query, item, index.idf || {});
      if (!best || result.score > best.score) {
        best = {
          match: result.score >= threshold ? item : null,
          score: result.score,
          bestQuestion: item.question,
          breakdown: result.breakdown
        };
      }
    });

    if (!best) {
      return { match: null, score: 0, bestQuestion: '', breakdown: {} };
    }

    if (best.score < threshold) {
      best.match = null;
    }
    return best;
  }

  return {
    normalizeText: normalizeText,
    charBigrams: charBigrams,
    tokenize: tokenize,
    jaccardSimilarity: jaccardSimilarity,
    diceCoefficient: diceCoefficient,
    cosineSimilarity: cosineSimilarity,
    buildIndex: buildIndex,
    findBestMatch: findBestMatch,
    scoreCandidate: scoreCandidate
  };
});
