import { createHash } from 'node:crypto';
import { CACHE_VERSION, ClassifyOptions, JevAnswer, JevAuthError, makePoster, mapLimit, openCache, validAnswer } from '../classify/jev.js';
import { Analysis, AtlasNode } from '../graph.js';
import { t } from '../i18n.js';
import { FunctionPrint } from './fingerprint.js';

const INSTRUCTIONS =
  'Do these two functions do the same job, so that one could replace the other (possibly with a parameter)? ' +
  'Judge from what they compute and the APIs they call, not from their names or formatting.';
const CRITERIA = {
  same: 'They do the same job; one could be merged into the other or replaced by a shared helper.',
  different: 'They only look alike; they serve different purposes or behave differently.',
};

export interface VerifyStats {
  asked: number;
  same: number;
  cacheHits: number;
  failed: number;
  inputTokens: number;
}

/**
 * 구조로 찾은 중복 후보 중 앞쪽 limit 개를 Jev(TypeSafe) 에 "같은 일을 하나" 로 물어 jev 결과를 붙인다.
 * 묶음은 앞의 두 함수로 묻는다. 두 함수의 경로 · 이름 · 본문(앞 3,000자)을 보낸다.
 */
export async function verifyDuplicates(
  analysis: Analysis,
  prints: FunctionPrint[],
  nodes: Map<string, AtlasNode>,
  model: string,
  limit: number,
  options: ClassifyOptions,
): Promise<VerifyStats> {
  const stats: VerifyStats = { asked: 0, same: 0, cacheHits: 0, failed: 0, inputTokens: 0 };
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new JevAuthError(t('jev.noKey'));
  const text = new Map(prints.map((p) => [p.id, p.text]));
  const describe = (id: string) => {
    const n = nodes.get(id);
    return { name: n?.name ?? id, path: n?.path ?? '', source: text.get(id) ?? '' };
  };
  const targets = analysis.duplicates.slice(0, limit).filter((d) => text.has(d.members[0]) && text.has(d.members[1]));
  stats.asked = targets.length;

  const { cache, put, flush } = openCache(options.cacheDir, options.log);
  const post = makePoster(apiKey, options, 'same');
  let authError: JevAuthError | undefined;
  try {
    await mapLimit(targets, options.concurrency ?? 8, () => !!authError, async (set) => {
      try {
        const state = { first: describe(set.members[0]), second: describe(set.members[1]) };
        const key = createHash('sha256')
          .update(JSON.stringify({ v: CACHE_VERSION, model, instructions: INSTRUCTIONS, criteria: CRITERIA, state }))
          .digest('hex');
        let answer: JevAnswer;
        if (cache[key]) {
          stats.cacheHits += 1;
          answer = cache[key].answer;
        } else {
          const res = await post({ model, state, questions: { same: { type: 'choice', instructions: INSTRUCTIONS, criteria: CRITERIA } } });
          stats.inputTokens += res.inputTokens;
          if (!validAnswer(res.answer, CRITERIA)) throw new Error(t('jev.badAnswer', { choice: String(res.answer.choice).slice(0, 40) }));
          answer = res.answer;
          put(key, answer);
        }
        set.jev = { same: answer.choice === 'same', confidence: answer.confidence };
        if (set.jev.same) stats.same += 1;
      } catch (e) {
        if (e instanceof JevAuthError) authError ??= e;
        else if (!authError) {
          stats.failed += 1;
          options.log?.(t('jev.pairFailed', { pair: set.members.slice(0, 2).join(' ⇄ '), message: (e as Error).message }));
        }
      }
      return true;
    });
  } finally {
    flush();
  }
  if (authError) throw authError;
  return stats;
}
