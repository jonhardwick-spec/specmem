#!/usr/bin/env node
/**
 * Bullshit Radar - detecting when claude gets too agreeable
 *
 * yooo this aint no copy - we built our own intellectual detection system
 * based on linguistic analysis of performative vs substantive responses
 *
 * The Theory:
 * - Sycophancy is performative agreement without epistemic grounding
 * - Real responses have uncertainty, verification, pushback
 * - Bullshit has confidence without evidence
 *
 * Hook Event: UserPromptSubmit (analyzes previous claude response)
 *
 * @author hardwicksoftwareservices
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================================
// BULLSHIT TAXONOMY - our intellectual framework fr fr
// ============================================================================

const BS_PATTERNS = {
  // PERFORMATIVE AGREEMENT - saying yes without thinking
  performative: {
    weight: 0.30,
    patterns: [
      /you'?re? (absolutely|completely|totally|entirely) (right|correct)/i,
      /that'?s? (a )?(great|excellent|fantastic|wonderful|brilliant) (point|question|idea|observation)/i,
      /I (completely|totally|fully|absolutely) agree/i,
      /you make an? (excellent|great|valid|good) point/i,
    ],
    desc: 'agreeing without epistemic justification'
  },

  // PREMATURE CLOSURE - claiming done without verification
  premature: {
    weight: 0.35,
    patterns: [
      /^(Done|Fixed|Completed|Finished)[.!]?$/im,
      /successfully (implemented|created|fixed|updated|added)/i,
      /that should (fix|solve|resolve|work)/i,
      /everything (is|should be) (working|fixed|ready)/i,
    ],
    desc: 'claiming completion without showing verification'
  },

  // EAGER COMPLIANCE - too ready to please
  eager: {
    weight: 0.20,
    patterns: [
      /I'?ll (do that|fix that|get on that|handle that) (right away|immediately|now)/i,
      /consider it done/i,
      /on it[!.]/i,
      /let me (quickly|just|immediately)/i,
    ],
    desc: 'performative urgency without substance'
  },

  // VALIDATION SEEKING - fishing for approval
  validation: {
    weight: 0.15,
    patterns: [
      /hope (this|that) helps[!.]?/i,
      /let me know if (you need|there'?s|I can)/i,
      /feel free to (ask|reach out|let me know)/i,
      /happy to (help|assist|clarify)/i,
    ],
    desc: 'seeking approval rather than delivering value'
  },

  // HOLLOW CONFIDENCE - certainty without evidence
  hollow: {
    weight: 0.25,
    patterns: [
      /this (will|should) (definitely|certainly|absolutely) work/i,
      /I'?m (100%|completely|absolutely) (sure|certain|confident)/i,
      /there'?s no (way|chance|doubt)/i,
      /guaranteed to/i,
    ],
    desc: 'expressing certainty without epistemic warrant'
  }
};

// ============================================================================
// RIGOR INDICATORS - signs of actual thinking
// ============================================================================

const RIGOR_PATTERNS = {
  uncertainty: {
    weight: -0.15,
    patterns: [
      /I'?m not (entirely |completely )?(sure|certain)/i,
      /I (think|believe|suspect) (but|however)/i,
      /this (might|may|could) (not |be )/i,
      /I'?d need to (verify|check|confirm)/i,
    ]
  },

  verification: {
    weight: -0.20,
    patterns: [
      /let me (verify|check|confirm|read|look at)/i,
      /before I (claim|say|assert)/i,
      /looking at the (actual|real) (output|result|code)/i,
      /the (error|output|result) (shows|says|indicates)/i,
    ]
  },

  pushback: {
    weight: -0.25,
    patterns: [
      /I (disagree|don'?t think|wouldn'?t recommend)/i,
      /actually[,.]? (that|this|I)/i,
      /however[,.]? (I|we|this)/i,
      /that (might not|won'?t|wouldn'?t) (work|be|help)/i,
    ]
  },

  questioning: {
    weight: -0.15,
    patterns: [
      /could you clarify/i,
      /what (exactly |specifically )?(do you mean|are you)/i,
      /I'?m not sure I understand/i,
      /can you (explain|elaborate)/i,
    ]
  }
};

// ============================================================================
// DETECTION ENGINE
// ============================================================================

const STATE_PATH = path.join(os.tmpdir(), 'specmem-bs-radar-state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      // reset if stale (4 hours)
      if (Date.now() - state.lastUpdate > 4 * 60 * 60 * 1000) {
        return { detections: 0, score: 0, lastUpdate: Date.now() };
      }
      return state;
    }
  } catch (e) {}
  return { detections: 0, score: 0, lastUpdate: Date.now() };
}

function saveState(state) {
  state.lastUpdate = Date.now();
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch (e) {}
}

function analyzeResponse(text) {
  if (!text || text.length < 20) return { score: 0, signals: [], rigor: [] };

  let score = 0;
  const signals = [];
  const rigor = [];

  // detect bullshit patterns
  for (const [category, config] of Object.entries(BS_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(text)) {
        score += config.weight;
        signals.push({ category, desc: config.desc, weight: config.weight });
        break; // one match per category
      }
    }
  }

  // detect rigor patterns (reduce score)
  for (const [category, config] of Object.entries(RIGOR_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(text)) {
        score += config.weight; // negative weight
        rigor.push({ category, weight: config.weight });
        break;
      }
    }
  }

  // density multiplier - multiple signals in short text = worse
  if (signals.length >= 2 && text.length < 200) {
    score *= 1.4;
  } else if (signals.length >= 2 && text.length < 400) {
    score *= 1.2;
  }

  // toxic combos
  const categories = signals.map(s => s.category);
  if (categories.includes('performative') && categories.includes('premature')) {
    score += 0.2; // "you're right! done!" combo
  }
  if (categories.includes('eager') && categories.includes('premature')) {
    score += 0.15;
  }

  return { score: Math.max(0, Math.min(1, score)), signals, rigor };
}

// ============================================================================
// INTERVENTION MESSAGES - intellectual but real
// ============================================================================

function getIntervention(score, detections, signals) {
  const categories = signals.map(s => s.category).join(', ');

  if (score > 0.8 || detections >= 5) {
    // critical - full stop
    return `<bullshit-radar level="critical">
PATTERN DETECTED: High confidence responses without epistemic grounding.
Signals: ${categories}

REQUIRED ACTIONS:
1. STOP autonomous execution
2. Show actual evidence (command output, file contents)
3. Express genuine uncertainty where it exists
4. Ask clarifying questions if needed

Performative agreement ≠ helpfulness. Verification = respect.
</bullshit-radar>`;
  }

  if (score > 0.6 || detections >= 3) {
    // warning
    return `<bullshit-radar level="warning">
Rigor check triggered (${categories}).
Before responding: READ before editing, SHOW actual output, STATE assumptions.
Confidence requires evidence.
</bullshit-radar>`;
  }

  if (score > 0.4) {
    // gentle
    return `<bullshit-radar level="notice">
Minor signal: ${categories}. Consider: verify before claiming, show don't tell.
</bullshit-radar>`;
  }

  return null;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const input = await new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve({});
      }
    });
  });

  // get previous assistant response from context
  const messages = input.messages || [];
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');

  if (!lastAssistant) {
    console.log(JSON.stringify({}));
    return;
  }

  // extract text content
  let responseText = '';
  if (typeof lastAssistant.content === 'string') {
    responseText = lastAssistant.content;
  } else if (Array.isArray(lastAssistant.content)) {
    responseText = lastAssistant.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
  }

  if (!responseText || responseText.length < 30) {
    console.log(JSON.stringify({}));
    return;
  }

  // analyze
  const { score, signals, rigor } = analyzeResponse(responseText);
  const state = loadState();

  if (score > 0.35) {
    state.detections++;
    state.score = Math.max(state.score, score);
  } else if (rigor.length > 0) {
    // good behavior - reduce detection count
    state.detections = Math.max(0, state.detections - 1);
  }

  saveState(state);

  // generate intervention if needed
  const intervention = getIntervention(score, state.detections, signals);

  if (intervention) {
    console.log(JSON.stringify({
      message: intervention
    }));
  } else {
    console.log(JSON.stringify({}));
  }
}

module.exports = { analyzeResponse, BS_PATTERNS, RIGOR_PATTERNS };

main().catch(err => {
  console.log(JSON.stringify({}));
});
