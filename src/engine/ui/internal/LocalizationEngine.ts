import type {
  LocaleDictionary,
} from "../../../contracts/ui/types";

const DEFAULT_LOCALE = "pt-BR";

function languageOf(locale: string): string {
  const separator = locale.search(/[-_]/u);
  return (separator < 0 ? locale : locale.slice(0, separator)).toLowerCase();
}

/**
 * Dicionários por locale com cadeia de fallback:
 * locale exato → mesmo idioma (`en-GB` → `en-US`) → fallback → a própria chave.
 */
export class LocalizationEngine {
  private activeLocale = DEFAULT_LOCALE;
  private fallbackLocale = DEFAULT_LOCALE;
  private resolvedActive: string | null = DEFAULT_LOCALE;
  private readonly dictionaries = new Map<string, LocaleDictionary>();

  public constructor() {
    this.loadDefaultDictionaries();
  }

  public get currentLocale(): string {
    return this.activeLocale;
  }

  /** Locale de dicionário efetivamente usado para o idioma atual (ou null). */
  public get resolvedLocale(): string | null {
    return this.resolvedActive;
  }

  /**
   * Troca o idioma. Vazio/inválido é ignorado e devolve false (antes lançava).
   */
  public setLocale(locale: string): boolean {
    const normalized = typeof locale === "string" ? locale.trim() : "";

    if (normalized.length === 0) {
      console.warn("[LocalizationEngine] setLocale ignorado: locale vazio.");
      return false;
    }

    this.activeLocale = normalized;
    this.resolvedActive = this.resolveLocale(normalized);

    if (this.resolvedActive === null) {
      console.warn(
        `[LocalizationEngine] Sem dicionário para '${normalized}'; usando fallback '${this.fallbackLocale}'.`,
      );
    }

    return true;
  }

  public setFallbackLocale(locale: string): void {
    const normalized = typeof locale === "string" ? locale.trim() : "";

    if (normalized.length > 0) {
      this.fallbackLocale = normalized;
    }
  }

  public registerDictionary(locale: string, dictionary: LocaleDictionary): void {
    const normalized = typeof locale === "string" ? locale.trim() : "";

    if (normalized.length === 0) {
      throw new Error("LocalizationEngine.registerDictionary requer um locale não vazio.");
    }

    const existing = this.dictionaries.get(normalized);
    this.dictionaries.set(normalized, existing === undefined ? { ...dictionary } : { ...existing, ...dictionary });
    this.resolvedActive = this.resolveLocale(this.activeLocale);
  }

  public hasLocale(locale: string): boolean {
    return this.dictionaries.has(locale);
  }

  public getAvailableLocales(): string[] {
    return Array.from(this.dictionaries.keys());
  }

  /** true se a chave existe no idioma atual ou no fallback. */
  public hasTranslation(key: string): boolean {
    return this.lookup(key) !== undefined;
  }

  public translate(key: string, params?: Record<string, string | number>): string {
    let text = this.lookup(key) ?? key;

    if (!params) {
      return text;
    }

    for (const parameterKey of Object.keys(params)) {
      const value = params[parameterKey];
      const token = `{${parameterKey}}`;
      // split/join evita RegExp dinâmico e caracteres especiais nos nomes.
      text = text.split(token).join(String(value));
    }

    return text;
  }

  /**
   * Atualiza `[data-i18n]` sob `root`. Só reescreve elementos cuja chave
   * existe nos dicionários (G97): textos do jogo com chaves próprias ficam
   * intactos. `data-i18n-attr="placeholder"` traduz um atributo em vez do texto.
   */
  public updateDOMTranslations(root: ParentNode): void {
    const elements = root.querySelectorAll<HTMLElement>("[data-i18n]");

    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];

      if (!element) {
        continue;
      }

      const key = element.getAttribute("data-i18n");

      if (!key) {
        continue;
      }

      const translated = this.lookup(key);

      if (translated === undefined) {
        continue;
      }

      const attribute = element.getAttribute("data-i18n-attr");

      if (attribute !== null && attribute.length > 0) {
        element.setAttribute(attribute, translated);
      } else {
        element.textContent = translated;
      }
    }
  }

  private lookup(key: string): string | undefined {
    if (this.resolvedActive !== null) {
      const value = this.dictionaries.get(this.resolvedActive)?.[key];

      if (value !== undefined) {
        return value;
      }
    }

    const fallback = this.resolveLocale(this.fallbackLocale);
    return fallback === null ? undefined : this.dictionaries.get(fallback)?.[key];
  }

  private resolveLocale(locale: string): string | null {
    if (this.dictionaries.has(locale)) {
      return locale;
    }

    const lower = locale.toLowerCase();

    for (const candidate of this.dictionaries.keys()) {
      if (candidate.toLowerCase() === lower) {
        return candidate;
      }
    }

    const language = languageOf(locale);

    for (const candidate of this.dictionaries.keys()) {
      if (languageOf(candidate) === language) {
        return candidate;
      }
    }

    return null;
  }

  private loadDefaultDictionaries(): void {
    this.registerDictionary("pt-BR", {
      "ui.menu.title": "Menu",
      "ui.menu.start": "Iniciar Jogo",
      "ui.menu.settings": "Configurações",
      "ui.menu.exit": "Sair para a Área de Trabalho",
      "ui.modal.close": "Fechar",
      "ui.screen.pause": "PAUSA",
      "ui.screen.inventory": "INVENTÁRIO",
      "ui.screen.settings": "CONFIGURAÇÕES",
      "ui.screen.dialogue": "DIÁLOGO",
      "ui.screen.gameOver": "FIM DE JOGO",
      "ui.welcome": "Bem-vindo, {name}!",
    });

    this.registerDictionary("en-US", {
      "ui.menu.title": "Menu",
      "ui.menu.start": "Start Game",
      "ui.menu.settings": "Settings",
      "ui.menu.exit": "Exit to Desktop",
      "ui.modal.close": "Close",
      "ui.screen.pause": "PAUSED",
      "ui.screen.inventory": "INVENTORY",
      "ui.screen.settings": "SETTINGS",
      "ui.screen.dialogue": "DIALOGUE",
      "ui.screen.gameOver": "GAME OVER",
      "ui.welcome": "Welcome, {name}!",
    });
  }
}
