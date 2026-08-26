export function removeTagId(tags: string[] | undefined, deletedTagId: string): string[] | undefined {
  if (!Array.isArray(tags) || !tags.includes(deletedTagId)) return undefined;
  return tags.filter((id) => id !== deletedTagId);
}
