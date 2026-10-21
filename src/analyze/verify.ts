import { createHash } from 'node:crypto';
import { CACHE_VERSION, ClassifyOptions, JevAnswer, JevAuthError, makePoster, mapLimit, openCache, validAnswer } from '../classify/jev.js';
import { Analysis, AtlasNode } from '../graph.js';
import { t } from '../i18n.js';
import { FunctionPrint } from './fingerprint.js';

const INSTRUCTIONS =
  'Compare the two TypeScript/JavaScript functions in the state (name, path, source). ' +
  'Answer "same" only if they implement the same behavior: given the same inputs they produce the same result and side effects, ' +
  'apart from names, constant values or formatting, so one could replace the other with at most an extra parameter. ' +
  'Answer "different" if they work on different data, call different APIs or endpoints, or produce different results, ' +
  'even when their structure looks alike.';
const CRITERIA = {
  same: 'Same behavior apart from names, constants or formatting; one can replace the other with at most an extra parameter.',
  different: 'Different behavior: different data, APIs, endpoints or results, even if the code is shaped alike.',
};

export interface VerifyStats {
  asked: number;
  /** 신뢰도 기준 이상으로 같다고 본 것 */
  same: number;
  /** 신뢰도가 기준보다 낮은 것 (같음 · 다름 어느 쪽이든) */
  unsure: number;
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
  /** 이보다 낮은 신뢰도의 답은 애매로 둔다 (classify.minConfidence) */
  minConfidence: number,
  options: ClassifyOptions,
): Promise<VerifyStats> {
  const stats: VerifyStats = { asked: 0, same: 0, unsure: 0, cacheHits: 0, failed: 0, inputTokens: 0 };
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
        const sure = answer.confidence >= minConfidence;
        set.jev = { same: answer.choice === 'same', confidence: answer.confidence, sure };
        if (!sure) stats.unsure += 1;
        else if (set.jev.same) stats.same += 1;
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
