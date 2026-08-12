/**
 * Какая модель каталога стоит за принтером, судя по тому, чем он представился.
 *
 * Принтер сообщает `hostname` (`/printer/info`) и `machine_name`
 * (`/machine/system_info`) — например `qidi-max4` и `QIDI`. Каталог знает 326
 * моделей под именами OrcaSlicer (`QIDI X-Max 4`). Между этими двумя строками
 * нет равенства, поэтому здесь именно сопоставление, а не поиск по ключу.
 *
 * Функция чистая: ни сети, ни DOM, ни типов приложения — оба приложения зовут
 * её над уже загруженным каталогом.
 *
 * Главное правило: **лучше ничего, чем не та картинка**. Любая неоднозначность
 * даёт `null`, а промахи чинятся курированием `aliases` на сервере — без
 * релиза приложений.
 */

export interface PrinterIdentity {
  /** `/printer/info` → `hostname`, например "qidi-max4". */
  hostname: string | null;
  /** `/machine/system_info` → `system_info.machine_name`, например "QIDI". */
  machineName: string | null;
}

export interface MatchableModel {
  key: string;
  vendorKey: string;
  name: string;
  aliases: string[];
}

export interface MatchableVendor {
  key: string;
  name: string;
}

/** Всё в нижний регистр, всё лишнее прочь: "QIDI X-Max 4" → "qidixmax4". */
function squash(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Буквенные и цифровые группы по отдельности: "qidi-max4" → ["qidi","max"] / ["4"]. */
function parts(value: string | null | undefined): { letters: string[]; numbers: string[] } {
  const source = (value || '').toLowerCase();
  return {
    letters: source.match(/[a-z]+/g) ?? [],
    numbers: source.match(/[0-9]+/g) ?? [],
  };
}

/** Числа как множество: порядок не значим, повторы не значимы. */
function sameNumbers(a: string[], b: string[]): boolean {
  const norm = (xs: string[]) => [...new Set(xs.map((n) => String(Number(n))))].sort();
  const left = norm(a);
  const right = norm(b);
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

export function matchPrinterModel(
  identity: PrinterIdentity | null,
  models: MatchableModel[],
  vendors: MatchableVendor[] = [],
): string | null {
  const host = squash(identity?.hostname);
  if (!host) return null;

  // Шаг 1. Точный матч по ключу и алиасам — механизм, который каталог везёт
  // именно для этого. Дешевле всего, но не застрахован от неоднозначности:
  // алиасы курируются вручную на сервере, и алиас одной модели может
  // случайно совпасть с ключом (или алиасом) другой — поэтому здесь тоже
  // действует общее правило уникальности, а не просто "первый нашёлся".
  const exactHits = new Set<string>();
  for (const model of models) {
    if (squash(model.key) === host || model.aliases.some((alias) => squash(alias) === host)) {
      exactHits.add(model.key);
    }
  }
  if (exactHits.size === 1) return [...exactHits][0];
  if (exactHits.size > 1) return null; // неоднозначность — это отказ, а не повод угадывать в шаге 2

  // Шаг 2. Матч внутри вендора. Без вендора шага нет: сравнивать `max4` со
  // всеми 326 моделями — верный способ выдать чужую картинку.
  const vendorHint = squash(identity?.machineName);
  if (!vendorHint) return null;

  const vendorKeys = new Set(
    vendors
      .filter((v) => squash(v.key) === vendorHint || squash(v.name) === vendorHint)
      .map((v) => v.key),
  );
  // Каталог может не отдать вендоров — тогда сам ключ модели служит подсказкой.
  if (vendorKeys.size === 0) {
    for (const model of models) {
      if (squash(model.vendorKey) === vendorHint) vendorKeys.add(model.vendorKey);
    }
  }
  if (vendorKeys.size === 0) return null;

  const hostParts = parts(identity?.hostname);
  // Имя вендора в hostname — это вендор, а не признак модели.
  const hostLetters = hostParts.letters.filter((token) => token !== vendorHint);
  if (hostParts.numbers.length === 0) return null; // нечем отличить соседние модели

  const hits: string[] = [];
  for (const model of models) {
    if (!vendorKeys.has(model.vendorKey)) continue;

    const modelParts = parts(model.name);
    if (!sameNumbers(hostParts.numbers, modelParts.numbers)) continue;

    // Односторонне: hostname короче полного имени ("qidi-max4" против
    // "QIDI X-Max 4"), так что требуем вхождения его токенов в имя, а не
    // наоборот. Токен-к-токену, а не в склейку всех токенов модели — иначе
    // токен хоста может собраться из хвоста одного слова модели и головы
    // соседнего (склейка "xtra"+"max" даёт "tram", которого в имени нет).
    if (!hostLetters.every((token) => modelParts.letters.some((modelToken) => modelToken.includes(token)))) continue;

    hits.push(model.key);
  }

  return hits.length === 1 ? hits[0] : null;
}
