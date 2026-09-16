const ISSUE_TERMS = ['bug', '问题', '缺陷', '故障', '错误', '异常', '报错'];
const FEEDBACK_TERMS = ['反馈', '报告', '记录'];
const ISSUE_SYMPTOM_PATTERNS = [
  /无法|不能|失败|没反应|无响应|不生效|失效/,
  /消失|丢失|卡死|崩溃|闪退/,
  /打不开|连不上|不同步|打印不了|出错/,
];

export function normalizeTagNameForMatch(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^#+/, '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase();
}

export function findExistingTagName(value: string, availableNames: string[]): string | undefined {
  const normalized = normalizeTagNameForMatch(value);
  if (!normalized) return undefined;
  const exact = availableNames.find((name) => normalizeTagNameForMatch(name) === normalized);
  if (exact) return exact;
  // 模型偶尔会返回“父标签/子标签”路径；任务字段最终仍使用现有子标签名称。
  const tail = value.split(/[/>＞]/).pop()?.trim();
  if (!tail || tail === value) return undefined;
  const normalizedTail = normalizeTagNameForMatch(tail);
  return availableNames.find((name) => normalizeTagNameForMatch(name) === normalizedTail);
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function hasIssueEvidence(text: string): boolean {
  return containsAny(text, ISSUE_TERMS) || ISSUE_SYMPTOM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 保留模型选择的标签，并为明确的 Bug/问题记录确定性补齐一个已存在的问题类标签。
 * 这里只返回现有名称，不创建标签，也不对普通任务做宽泛的关键词猜测。
 */
export function inferExistingTaskTags(
  input: string,
  availableNames: string[],
  proposedNames: string[] = [],
  explicitlySelectedNames: string[] = [],
): string[] {
  const normalizedInput = normalizeTagNameForMatch(input);
  const inputHasIssueEvidence = hasIssueEvidence(normalizedInput);
  const explicitlySelected = new Set(
    explicitlySelectedNames.map((name) => normalizeTagNameForMatch(findExistingTagName(name, availableNames) || name)),
  );
  const result: string[] = [];
  for (const proposed of proposedNames) {
    const canonical = findExistingTagName(proposed, availableNames) || proposed.trim();
    const normalizedCanonical = normalizeTagNameForMatch(canonical);
    // 中性的测试、验证和方案检查经常被模型误判为 Bug。仅由模型选择的问题类标签
    // 需要正文中的问题词或故障症状支撑；用户明确拖入的标签始终保留。
    if (canonical && containsAny(normalizedCanonical, ISSUE_TERMS)
      && !inputHasIssueEvidence && !explicitlySelected.has(normalizedCanonical)) {
      continue;
    }
    if (canonical && !result.some((name) => normalizeTagNameForMatch(name) === normalizeTagNameForMatch(canonical))) {
      result.push(canonical);
    }
  }

  if (!inputHasIssueEvidence) return result;
  if (result.some((name) => containsAny(normalizeTagNameForMatch(name), ISSUE_TERMS))) return result;

  const inputIssueTerms = ISSUE_TERMS.filter((term) => normalizedInput.includes(term));
  const inputHasFeedback = containsAny(normalizedInput, FEEDBACK_TERMS);
  const candidates = availableNames
    .map((name, index) => {
      const normalizedName = normalizeTagNameForMatch(name);
      const tagIssueTerms = ISSUE_TERMS.filter((term) => normalizedName.includes(term));
      if (!tagIssueTerms.length) return null;
      let score = 10;
      if (normalizedInput.includes(normalizedName)) score += 100;
      score += tagIssueTerms.filter((term) => inputIssueTerms.includes(term)).length * 30;
      if (inputHasFeedback && containsAny(normalizedName, FEEDBACK_TERMS)) score += 15;
      return { name, index, score };
    })
    .filter((item): item is { name: string; index: number; score: number } => !!item)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (candidates[0]) result.push(candidates[0].name);
  return result;
}
