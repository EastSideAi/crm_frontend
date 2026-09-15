/* Озвучка реплик преподавателя (поле say у экрана курса Академии).

   Зачем отдельный инструмент: текст урока правится десятки раз, а звук должен
   идти следом. Скрипт читает academy-courses.js, синтезирует РОВНО те реплики,
   которые изменились (имя файла — хеш текста и голоса), и переписывает карту
   academy-voice.js, откуда фронт узнает, у какого экрана есть звук.

   Запуск:  node tools/voice.mjs            — досинтезировать изменившееся
            node tools/voice.mjs --all      — пересобрать все заново
            node tools/voice.mjs --voice ru-RU-SvetlanaNeural

   Движок — edge-tts (нейронные голоса Microsoft, ключа не требуют):
   pip install --user edge-tts, бинарь ложится в ~/.local/bin/edge-tts. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
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

// academy-courses.js — простой скрипт, который кладет массив в window.
const sandbox = {};
new Function('window', readFileSync(join(ROOT, 'academy-courses.js'), 'utf8'))(sandbox);
const courses = sandbox.AC_COURSES || [];

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// Сервис Microsoft режет частоту: несколько реплик подряд без паузы, и он
// начинает отдавать пустой поток (NoAudioReceived). Отсюда пауза между
// репликами и долгое отступление при отказе — на курсе в сотню реплик прогон
// иначе умирает на середине.
// Отрицательный тон передается через «=»: иначе argparse у edge-tts читает
// «-2Hz» как еще один ключ и падает.
const PAUSE_SEC = 2;
const BACKOFF_SEC = [15, 30, 60];

function sleep(sec) { execFileSync('sleep', [String(sec)]); }

function say(text, path) {
  for (let i = 0; ; i++) {
    try {
      execFileSync(BIN, ['--voice', VOICE, '--rate', RATE, '--pitch=' + PITCH,
        '--text', text, '--write-media', path], { stdio: 'pipe' });
      sleep(PAUSE_SEC);
      return;
    } catch (e) {
      if (i >= BACKOFF_SEC.length) throw e;
      console.log('сервис молчит, жду', BACKOFF_SEC[i], 'с и повторяю');
      sleep(BACKOFF_SEC[i]);
    }
  }
}

const map = {};
const keep = new Set();
let made = 0;

for (const c of courses) {
  (c.lessons || []).forEach((les, li) => {
    (les.screens || []).forEach((sc, si) => {
      if (!sc.say) return;
      const key = c.id + '-' + li + '-' + si;
      const hash = createHash('sha1').update(VOICE + '|' + RATE + '|' + PITCH + '|' + sc.say).digest('hex').slice(0, 12);
      const file = c.id + '-' + hash + '.mp3';
      map[key] = file;
      keep.add(file);
      const path = join(OUT, file);
      if (!ALL && existsSync(path)) return;
      say(sc.say, path);
      made++;
      console.log('озвучено', key, '→', file);
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

console.log('готово: реплик', Object.keys(map).length, '· синтезировано', made, '· голос', VOICE);
