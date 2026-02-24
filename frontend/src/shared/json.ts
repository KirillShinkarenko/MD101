export const parseJsonSafe = <T,>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

export const prettyJsonText = (text: string | null | undefined): string => {
  if (!text) {
    return "";
  }
  const parsed = parseJsonSafe<unknown>(text);
  if (parsed === null) {
    return text;
  }
  return JSON.stringify(parsed, null, 2);
};
