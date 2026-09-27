/* Озвучка экранов Академии: голос читает СЛАЙД ЦЕЛИКОМ.

   Павел 15.09.2026: «хочется чтобы он все озвучивал на слайде». Поэтому
   сценарий собирается из полей экрана в порядке чтения — заголовок, текст,
   пункты, предупреждение — и заканчивается репликой преподавателя (say).
   Второго текста для диктора не заводим: правится урок, звук идет следом.

   Зачем отдельный инструмент: текст урока правится десятки раз, а звук должен
   идти следом. Скрипт читает academy-courses.js, синтезирует РОВНО те экраны,
   которые изменились (имя файла — хеш сценария и голоса), и переписывает карту
   academy-voice.js, откуда фронт узнает, у какого экрана есть звук.

   Запуск:  node tools/voice.mjs            — досинтезировать изменившееся
            node tools/voice.mjs --all      — пересобрать все заново
            node tools/voice.mjs --voice ru-RU-SvetlanaNeural

   Движок — edge-tts (нейронные голоса Microsoft, ключа не требуют):
   pip install --user edge-tts, бинарь ложится в ~/.local/bin/edge-tts. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/academy/voice');
const MAP = join(ROOT, 'academy-voice.js');
const BIN = process.env.EDGE_TTS || '/data/.local/bin/edge-tts';

const args = process.argv.slice(2);
const VOICE = args.includes('--voice') ? args[args.indexOf('--voice') + 1] : 'ru-RU-DmitryNeural';
// Голос преподавателя: мужской, теплый. Темп чуть выше дикторского, тон чуть
// ниже стандартного — так речь перестает звучать как объявление на вокзале.
const RATE = '+3%';
const PITCH = '-2Hz';
const ALL = args.includes('--all');
const DRY = args.includes('--dry');       // показать сценарии, ничего не синтезируя

// academy-courses.js — простой скрипт, который кладет массив в window.
const sandbox = {};
new Function('window', readFileSync(join(ROOT, 'academy-courses.js'), 'utf8'))(sandbox);
const courses = sandbox.AC_COURSES || [];

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* Сценарий экрана — то, что диктор произносит вслух.

   Экран рисуется по типу (rules, tariffs, stage, q и так далее), поэтому и
   сценарий собирается по типу: у каждого свои поля, и порядок чтения должен
   совпадать с порядком на экране, иначе слушатель теряет, о чем речь. */
function screenScript(sc) {
  const out = [];
  const add = (...xs) => xs.forEach((x) => { if (x) out.push(String(x)); });

  add(sc.eye, sc.h, ...(sc.body || []));

  if (sc.type === 'rules') (sc.items || []).forEach((it) => add(mark(it[0]) + pair(it[1], it[2])));
  if (sc.type === 'check') add(...(sc.items || []));
  if (sc.type === 'quote' && sc.quote) add(sc.quote.text, sc.quote.who);
  // Рубль дописывается сам, но не к строке, где единица уже своя («3,2% суммы»)
  // — то же правило, что на экране.
  if (sc.type === 'pay') (sc.rows || []).forEach((r) => add(r[0] + ': ' + money(r[1])));
  if (sc.type === 'deduct') (sc.groups || []).forEach((g) => {
    add(g.t + ', ' + money(g.rate));
    (g.rows || []).forEach((r) => add(r[0] + ': ' + r[1]));
  });
  if (sc.type === 'shot') (sc.pins || []).forEach((p) => add(p[0] + '. ' + pair(p[1], p[2])));
  if (sc.type === 'task') { add(...(sc.steps || [])); add(sc.chk); }
  if (sc.type === 'stage') {
    add(sc.when && 'Когда: ' + sc.when, sc.who && 'Кто ведет: ' + sc.who, sc.point && 'Оплата: ' + sc.point);
    (sc.cols || []).forEach((c) => { add(c[0] + '.'); add(...(c[1] || [])); });
    (sc.tar || []).forEach((t) => add(pair(t[1], t[2])));
    add(sc.dl, sc.done && 'Этап закрыт, когда: ' + sc.done);
  }
  if (sc.type === 'tariffs') (sc.cards || []).forEach((c) => {
    add(c.n + ', ' + c.cnt + '.', c.pos);
    add(...(c.items || []));
    add('Заканчиваем ' + c.ends + '.');
  });
  if (sc.type === 'chklist') { add('Отметьте, что уже умеете.'); add(...(sc.items || [])); }
  if (sc.type === 'howto') (sc.items || []).forEach((it, i) => add((i + 1) + '. ' + it[0] + '. Где: ' + it[1]));
  if (sc.type === 'q') { add(...(sc.sit || []), sc.lead); (sc.opts || []).forEach((o) => add(o[0] + '. ' + o[1])); }

  if (sc.note && sc.note.t) add((sc.note.warn ? 'Важно. ' : '') + sc.note.t);
  // Реплику преподавателя на вопросе не читаем: она объясняет верный ответ, и
  // вслух до ответа это подсказка. На экране она тоже появляется после ответа.
  if (sc.type !== 'q') add(sc.say);

  return out.map(clean).filter(Boolean).map(dot).join(' ');
}

// Значок вместо номера («✓», «✕») диктору читать нечем: в списке правил он
// значит «так делаем» и «так не делаем», и это слышно из самой фразы.
const MARKS = { '✓': '', '✕': 'Нет. ', '✗': 'Нет. ', '•': '', '·': '' };
function mark(m) { const k = String(m || '').trim(); return k in MARKS ? MARKS[k] : (k ? k + '. ' : ''); }

// Заголовок пункта и пояснение к нему: если заголовок уже закончен знаком,
// двоеточие после него читается как заикание.
function pair(a, b) {
  const t = String(a || '').trim(), r = String(b || '').trim();
  if (!r) return t;
  if (!t) return r;
  return /[.!?:;,»)]$/.test(t) ? t + ' ' + r : t + ': ' + r;
}

function money(v) { const s = String(v); return /[₽%]/.test(s) ? s : s + ' ₽'; }

/* Чистка под голос: разметка, знаки и числа, которые движок читает не так.
   «06» он произносит «ноль шесть», «₽» молчит, «4 000» распадается на два
   числа — все это слышно сразу и звучит как робот. */
function clean(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/ /g, ' ')
    .replace(/(\d)\s+(\d{3})\b/g, '$1$2')       // 4 000 → 4000
    .replace(/\b0(\d)\b/g, '$1')                // этап 06 → этап 6
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')   // диапазон: 15—40 → 15-40
    .replace(/\s*₽/g, ' рублей')
    .replace(/\s*%/g, ' процентов')
    .replace(/\s*×\s*/g, ' умножить на ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Диктор делает паузу по знаку конца предложения — без него слайд читается
// одной длинной строкой без единого вдоха.
function dot(s) { return /[.!?:;,]$/.test(s) ? s : s + '.'; }

// Сервис Microsoft режет частоту: несколько реплик подряд без паузы, и он
// начинает отдавать пустой поток (NoAudioReceived). Отсюда пауза между
// репликами и долгое отступление при отказе — на курсе в сотню реплик прогон
// иначе умирает на середине.
// Отрицательный тон передается через «=»: иначе argparse у edge-tts читает
// «-2Hz» как еще один ключ и падает.
const PAUSE_SEC = 4;
const BACKOFF_SEC = [20, 45, 90, 180];
// Экран на тысячу знаков это полторы-две минуты речи, а поток идет медленнее
// реального времени: на 90 секундах таймаут рубил КАЖДУЮ длинную реплику, и прогон
// выглядел как «сервис молчит» при живом сервисе (25.09.2026, урок про аудит).
const TTS_TIMEOUT_MS = 300000;            // зависший поток не должен держать прогон

function sleep(sec) { execFileSync('sleep', [String(sec)]); }

// ffmpeg в песочнице есть не всегда (21.09.2026 его снесли вместе с образом), а
// edge-tts и без него отдает готовый mp3 — просто на 48 кбит/с вместо наших 32.
// Без этой проверки прогон падал на каждом экране и уходил в отступление по
// 20/45/90/180 секунд, то есть выглядел как «сервис не отдает звук», хотя звук
// приходил. Нет ffmpeg — берем поток как есть и говорим об этом один раз.
const HAS_FFMPEG = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' }); return true; }
  catch { console.log('ffmpeg не найден: складываю звук как есть, 48 кбит/с вместо 32'); return false; }
})();

function say(text, path) {
  for (let i = 0; ; i++) {
    try {
      execFileSync(BIN, ['--voice', VOICE, '--rate', RATE, '--pitch=' + PITCH,
        '--text', text, '--write-media', path + '.raw'], { stdio: 'pipe', timeout: TTS_TIMEOUT_MS });
      // Движок отдает 48 кбит/с. Речи хватает 32: на курс это минус треть
      // веса и репозитория, и того, что грузит тьютор с телефона.
      if (HAS_FFMPEG) {
        execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-threads', '2', '-i', path + '.raw',
          '-ac', '1', '-ar', '24000', '-b:a', '32k', path], { stdio: 'pipe' });
        unlinkSync(path + '.raw');
      } else {
        renameSync(path + '.raw', path);
      }
      sleep(PAUSE_SEC);
      return true;
    } catch (e) {
      // Прогон на сотню экранов не должен умирать из-за одного отказа: экран
      // пропускается, а следующий запуск без --all доберет пропущенное.
      if (i >= BACKOFF_SEC.length) { console.log('ПРОПУЩЕН, сервис не отдал звук:', path.split('/').pop()); return false; }
      console.log('сервис молчит, жду', BACKOFF_SEC[i], 'с и повторяю');
      sleep(BACKOFF_SEC[i]);
    }
  }
}

const map = {};
const keep = new Set();
let made = 0;
let miss = 0;

for (const c of courses) {
  (c.lessons || []).forEach((les, li) => {
    (les.screens || []).forEach((sc, si) => {
      const text = screenScript(sc);
      if (!text) return;
      const key = c.id + '-' + li + '-' + si;
      const hash = createHash('sha1').update(VOICE + '|' + RATE + '|' + PITCH + '|' + text).digest('hex').slice(0, 12);
      const file = c.id + '-' + hash + '.mp3';
      map[key] = file;
      keep.add(file);
      const path = join(OUT, file);
      if (DRY) { console.log('\n— ' + key + ' (' + text.length + ' знаков)\n' + text); return; }
      if (!ALL && existsSync(path)) return;
      if (say(text, path)) { made++; console.log('озвучено', key, '→', file); }
      else miss++;
    });
  });
}

// Файлы реплик, которых в курсе больше нет, убираем сами: иначе папка растет
// на каждой правке текста, а в репозитории это мегабайты мертвого звука.
for (const f of readdirSync(OUT)) {
  if (f.endsWith('.mp3') && !keep.has(f)) { unlinkSync(join(OUT, f)); console.log('удален старый', f); }
}

writeFileSync(MAP,
  '/* Карта озвучки: «курс-урок-экран» → файл в assets/academy/voice.\n' +
  '   Собирается командой node tools/voice.mjs, руками не правится. */\n' +
  'window.AC_VOICE = ' + JSON.stringify(map, null, 2) + ';\n');

console.log('готово: экранов', Object.keys(map).length, '· синтезировано', made,
  (miss ? '· пропущено ' + miss + ' (запусти еще раз без --all)' : ''), '· голос', VOICE);
