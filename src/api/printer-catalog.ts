/**
 * Каталог принтеров: типы, индекс и ответ на вопрос «какая это машина».
 *
 * Живёт в SDK, а не в каждом приложении, намеренно. Десктоп и мобилка держат
 * SDK по-разному (вендорная копия против сабмодуля), и любая логика, у которой
 * есть две копии, рано или поздно расходится — на этой самой неделе так
 * пропали две карточки нагрева. Карточка, пикер и оба приложения обязаны
 * отвечать одинаково, поэтому логика тут одна.
 *
 * Загрузка каталога сюда не входит: у десктопа и мобилки разные HTTP-клиенты и
 * разные способы донести картинку до вьюпорта. Здесь только чистые функции.
 *
 * Асимметрия между облачным и локальным принтером намеренная. Ключ облачного
 * приходит с сервера, и если каталог его не знает — честнее показать сырую
 * строку («CD400»), чем промолчать. Ключ локального человек выбрал сам из
 * каталога, и если он оттуда исчез, показывать нечего: строка вида
 * «qidi-x-max-4» ничего не значит для того, кто её не набирал.
 */

export interface CatalogVendor {
  key: string;
  name: string;
}

export interface CatalogModel {
  key: string;
  vendorKey: string;
  name: string;
  /** Строки, под которыми принтер может представиться вместо ключа. */
  aliases: string[];
  coverUrl: string | null;
  coverSha256: string | null;
  hasProfile: boolean;
}

export interface PrinterCatalog {
  version: number;
  vendors: CatalogVendor[];
  models: CatalogModel[];
}

export interface CatalogIndex {
  catalog: PrinterCatalog;
  /** Ключи и алиасы в нижнем регистре → модель. */
  byKey: Map<string, CatalogModel>;
  vendorNameByKey: Map<string, string>;
}

export interface ResolvablePrinter {
  source?: 'cloud' | 'local';
  /** Ключ модели от сервера (облачное устройство). */
  printer_model_key?: string | null;
  /** Ключ модели, выбранный человеком (локальный принтер). */
  catalogModelKey?: string | null;
  /**
   * Ключ, который приложение определило само по тому, чем принтер
   * представился. Слабее обоих источников выше и никогда их не перекрывает.
   */
  autoModelKey?: string | null;
}

export interface ResolvedPrinterModel {
  vendorName: string | null;
  modelName: string;
  model: CatalogModel | null;
  hasProfile: boolean;
}

export function buildCatalogIndex(catalog: PrinterCatalog): CatalogIndex {
  const byKey = new Map<string, CatalogModel>();
  for (const model of catalog.models) {
    byKey.set(model.key, model);
    // Алиас не перебивает настоящий ключ другой модели: имя, выбранное
    // вендором, весомее строки, добавленной ради совместимости.
    for (const alias of model.aliases) {
      if (!byKey.has(alias)) byKey.set(alias, model);
    }
  }

  const vendorNameByKey = new Map<string, string>();
  for (const vendor of catalog.vendors) vendorNameByKey.set(vendor.key, vendor.name);

  return { catalog, byKey, vendorNameByKey };
}

const normalize = (value: string | null | undefined): string | null => {
  const trimmed = (value || '').trim().toLowerCase();
  return trimmed || null;
};

export function resolvePrinterModel(
  printer: ResolvablePrinter,
  index: CatalogIndex | null,
): ResolvedPrinterModel | null {
  const isLocal = printer.source === 'local';
  const chosen = isLocal
    ? normalize(printer.catalogModelKey)
    : normalize(printer.printer_model_key);
  // Догадка — только на пустое место. Порядок здесь и есть весь приоритет
  // источников: ручной выбор > ключ с сервера > автоопределение.
  const auto = normalize(printer.autoModelKey);
  const key = chosen ?? auto;

  if (!key) return null;

  const model = index?.byKey.get(key) ?? null;

  if (!model) {
    // Локальный принтер: ключ выбирали из каталога, и без каталога он
    // нечитаем — лучше ничего, чем техническая строка. Догадка — тем более:
    // её вообще никто не набирал.
    if (isLocal || !chosen) return null;
    return { vendorName: null, modelName: key, model: null, hasProfile: false };
  }

  return {
    vendorName: index?.vendorNameByKey.get(model.vendorKey) ?? null,
    modelName: model.name,
    model,
    hasProfile: model.hasProfile,
  };
}
