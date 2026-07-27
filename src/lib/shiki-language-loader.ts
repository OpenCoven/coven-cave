type LoadableLanguageHighlighter<Language> = {
  getLoadedLanguages(): string[];
  loadLanguage(...languages: Language[]): Promise<void>;
};

/**
 * Wrap a memoized Shiki factory with per-language loading. The in-flight map
 * prevents concurrent code blocks from requesting the same grammar twice;
 * completed entries leave the map because Shiki itself becomes the durable
 * source of truth through getLoadedLanguages().
 */
export function createLanguageHighlighterLoader<
  Language extends string,
  Highlighter extends LoadableLanguageHighlighter<Language>,
>(
  loadHighlighter: () => Promise<Highlighter>,
): (language: Language) => Promise<Highlighter> {
  const inFlight = new Map<Language, Promise<void>>();

  return async (language: Language) => {
    const highlighter = await loadHighlighter();
    if (highlighter.getLoadedLanguages().includes(language)) return highlighter;

    let languagePromise = inFlight.get(language);
    if (!languagePromise) {
      languagePromise = highlighter.loadLanguage(language).finally(() => {
        if (inFlight.get(language) === languagePromise) inFlight.delete(language);
      });
      inFlight.set(language, languagePromise);
    }
    await languagePromise;
    return highlighter;
  };
}
